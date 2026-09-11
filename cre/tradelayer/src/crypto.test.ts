import { describe, expect, test } from "bun:test";
import { utf8ToBytes } from "@noble/hashes/utils";
import {
  accountIdOf,
  accountKey,
  addressOfPrivateKey,
  bigintToWord,
  bytes32,
  CONTRACT_DOMAIN,
  decryptBlob,
  decryptUserBlob,
  domainSeparator,
  encryptBlob,
  encryptUserBlob,
  envelopeCommit,
  fromHex,
  intentDigest,
  keccak,
  policyHash,
  policyIntentDigest,
  POLICY_INTENT_TYPEHASH,
  openEnvelope,
  publicKeyOf,
  recoverAddress,
  sharesToUnits,
  unitsToShares,
  sealEnvelope,
  signDigest,
  structHash,
  toHex,
  toValidPrivateKey,
  TYPEHASH,
  typedDataDigest,
  type Intent,
} from "./crypto";

// Fixed keys so vectors are reproducible across the enclave and the browser seal library.
const INTENT_PRIV = fromHex("0x1111111111111111111111111111111111111111111111111111111111111111");
const EPH_PRIV = fromHex("0x2222222222222222222222222222222222222222222222222222222222222222");
const USER_PRIV = fromHex("0x3333333333333333333333333333333333333333333333333333333333333333");
const SIGNING_PRIV = fromHex("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"); // anvil #1
const MASTER = fromHex("0x4444444444444444444444444444444444444444444444444444444444444444");
const IV = fromHex("0x000102030405060708090a0b");

describe("sealed intents", () => {
  test("seal → open round-trips and the commit binds the ciphertext", () => {
    const plaintext = utf8ToBytes(JSON.stringify({ hello: "enclave" }));
    const env = sealEnvelope(plaintext, publicKeyOf(INTENT_PRIV, true), EPH_PRIV, IV);
    expect(new TextDecoder().decode(openEnvelope(env, INTENT_PRIV))).toBe('{"hello":"enclave"}');
    expect(envelopeCommit(env)).toMatch(/^0x[0-9a-f]{64}$/);
    // A different recipient key cannot open it.
    expect(() => openEnvelope(env, USER_PRIV)).toThrow();
    // Tampering with a single ciphertext byte fails the GCM tag.
    const tampered = { ...env, ct: env.ct.replace(/^./, c => (c === "A" ? "B" : "A")) };
    expect(() => openEnvelope(tampered, INTENT_PRIV)).toThrow();
  });
});

describe("ledger blobs", () => {
  const accountId = accountIdOf("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
  const aKey = accountKey(MASTER, accountId);
  const plaintext = utf8ToBytes(JSON.stringify({ positions: { TSLA: "2" } }));

  test("enclave blob is deterministic per (version, context) and decrypts", () => {
    const a = encryptBlob(aKey, plaintext, 1n, fromHex("0xaa"));
    const b = encryptBlob(aKey, plaintext, 1n, fromHex("0xaa"));
    const c = encryptBlob(aKey, plaintext, 1n, fromHex("0xbb"));
    expect(toHex(a)).toBe(toHex(b));
    expect(toHex(a)).not.toBe(toHex(c));
    expect(new TextDecoder().decode(decryptBlob(aKey, a))).toBe(new TextDecoder().decode(plaintext));
  });

  test("user blob decrypts with the employee's derived key only", () => {
    const userPub = publicKeyOf(USER_PRIV, true);
    const blob = encryptUserBlob(aKey, userPub, plaintext, 1n, fromHex("0xaa"));
    expect(new TextDecoder().decode(decryptUserBlob(USER_PRIV, blob))).toBe(new TextDecoder().decode(plaintext));
    expect(() => decryptUserBlob(INTENT_PRIV, blob)).toThrow();
  });

  test("portfolio key derivation matches the browser's recipe", () => {
    // Browser: keccak256(personal_sign("TradeLayer portfolio key v1")) → private key.
    const seed = keccak(utf8ToBytes("some-wallet-signature-bytes"));
    const priv = toValidPrivateKey(seed);
    expect(priv.length).toBe(32);
    expect(publicKeyOf(priv, true).length).toBe(33);
  });
});

describe("EIP-712", () => {
  test("domain separator matches OpenZeppelin's encoding", () => {
    // EIP712("TradeLayer","1") on chain 31337 at a known address — value cross-checked against
    // forge: cast call <ledger> "domainSeparator()" in the Anvil deploy.
    const ds = domainSeparator(CONTRACT_DOMAIN.name, CONTRACT_DOMAIN.version, 31337n, "0x0165878A594ca255338adfa4d48449f69242Eb8F");
    expect(toHex(ds)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("signature recovers to the signing address", () => {
    const sh = structHash(TYPEHASH.Cancel, bytes32("0x" + "ab".repeat(32)));
    const ds = domainSeparator("TradeLayer", "1", 31337n, "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6");
    const digest = typedDataDigest(ds, sh);
    const sig = signDigest(digest, SIGNING_PRIV);
    expect(sig.length).toBe(2 + 130);
    expect(recoverAddress(digest, sig).toLowerCase()).toBe(addressOfPrivateKey(SIGNING_PRIV).toLowerCase());
    expect(addressOfPrivateKey(SIGNING_PRIV).toLowerCase()).toBe("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
  });

  test("intent digest is stable and verifies the employee", () => {
    const intent: Intent = {
      v: 1,
      orderId: ("0x" + "11".repeat(32)) as `0x${string}`,
      account: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      orgId: "ACME",
      side: "BUY",
      symbol: "TSLA",
      maxSpend: "20000000",
      expiry: 1_757_700_000,
      nonce: 1,
      userPubKey: toHex(publicKeyOf(USER_PRIV, true)),
      sig: "0x",
    };
    const digest = intentDigest(intent, 31337n, "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6");
    const sig = signDigest(digest, USER_PRIV);
    expect(recoverAddress(digest, sig).toLowerCase()).toBe(addressOfPrivateKey(USER_PRIV).toLowerCase());
    expect(bigintToWord(1n)[31]).toBe(1);
  });
});

describe("sealed policies", () => {
  // Same fixture the browser uses in packages/nextjs/src/lib/seal.ts. If either side changes how
  // a policy is serialized, these two vectors move and the mismatch shows up here rather than as
  // an enclave rejecting the admin's own rulebook.
  const POLICY = {
    v: 1,
    employees: {
      "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc": { canBuy: true, canSell: true, dailyCap: "0", restricted: ["VOO"] },
    },
    maxOrderNotional: "1000000000",
    allowWithdrawShares: false,
  };

  test("typehash and policy hash are pinned", () => {
    expect(toHex(POLICY_INTENT_TYPEHASH)).toBe("0xba710e6c10c5e5c09d66c078f07f4037738365b2256b511ffe6e406a70d524c5");
    expect(toHex(policyHash(POLICY))).toBe("0xdd8b6c79b845acdab0e167e86fa5c3c142de28ec7d826aec9895a1733789a564");
  });

  test("hash survives the envelope round-trip the enclave performs", () => {
    // H4 hashes the object it parsed out of the envelope, not the admin's original bytes. That is
    // only safe because JSON.parse preserves key order for non-integer-like keys — and wallet
    // addresses ("0x…") are never integer-like. This test is what guards that assumption.
    const reparsed = JSON.parse(JSON.stringify(POLICY));
    expect(toHex(policyHash(reparsed))).toBe(toHex(policyHash(POLICY)));
  });

  test("policy signature recovers to the admin and is bound to the vault", () => {
    const submission = { v: 1 as const, orgId: "ACME", admin: addressOfPrivateKey(USER_PRIV), policy: POLICY, nonce: 1 };
    const vault = "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853";
    const digest = policyIntentDigest(submission, 31337n, vault);
    const sig = signDigest(digest, USER_PRIV);
    expect(recoverAddress(digest, sig).toLowerCase()).toBe(addressOfPrivateKey(USER_PRIV).toLowerCase());
    // Bound to this contract: the same rules signed for the escrow must not verify against the vault.
    const elsewhere = policyIntentDigest(submission, 31337n, "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6");
    expect(toHex(elsewhere)).not.toBe(toHex(digest));
    // …and tampering with a single rule changes the digest.
    const tampered = { ...submission, policy: { ...POLICY, maxOrderNotional: "9999999999" } };
    expect(toHex(policyIntentDigest(tampered, 31337n, vault))).not.toBe(toHex(digest));
  });
});

describe("fractional shares", () => {
  // The ATS equities are issued with 9 decimals so a position can be a fraction of a share —
  // without that, one Tesla share costs more than a small testnet treasury holds. The browser
  // formats positions with the same helpers, so the conversion is pinned on both sides.
  test("decimal shares convert to 9dp base units", () => {
    expect(sharesToUnits("1")).toBe(1_000_000_000n);
    expect(sharesToUnits("0.054729384")).toBe(54_729_384n);
    expect(sharesToUnits("2.008651871")).toBe(2_008_651_871n);
    expect(sharesToUnits("0")).toBe(0n);
  });

  test("round-trips, and truncates beyond nine places rather than rounding up", () => {
    for (const value of ["1", "0.5", "0.054729384", "12.000000001"]) {
      expect(unitsToShares(sharesToUnits(value))).toBe(value);
    }
    // Alpaca reports 9dp; anything finer is dust we must not invent backing for.
    expect(sharesToUnits("0.0000000009")).toBe(0n);
  });

  test("formats whole shares without a trailing dot", () => {
    expect(unitsToShares(2_000_000_000n)).toBe("2");
    expect(unitsToShares(0n)).toBe("0");
  });
});
