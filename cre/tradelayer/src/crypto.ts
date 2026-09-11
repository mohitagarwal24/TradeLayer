/**
 * All cryptography used inside the enclave, on pure-JS primitives only (@noble/*) so nothing here
 * depends on WebCrypto or Node built-ins, which the CRE WASM runtime does not provide.
 *
 * Wire formats are shared with the frontend seal library (packages/nextjs/src/lib/seal.ts) and
 * pinned by test vectors in crypto.test.ts — change them together.
 *
 *   Sealed intent   ECIES: ephemeral secp256k1 → ECDH → HKDF-SHA256 → AES-256-GCM
 *   Ledger blob     AES-256-GCM under a per-account key derived from the master key
 *   User blob       ECIES to the employee's derived public key, deterministic ephemeral key
 *   Authorizations  EIP-712 (hand-rolled encoder for the fixed struct set) + secp256k1
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { gcm } from "@noble/ciphers/aes";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

export type Hex = `0x${string}`;

/* ---------- encoding helpers ---------- */

export const toHex = (b: Uint8Array): Hex => `0x${bytesToHex(b)}`;
export const fromHex = (h: string): Uint8Array => hexToBytes(h.startsWith("0x") ? h.slice(2) : h);
export const keccak = (b: Uint8Array): Uint8Array => keccak_256(b);
export const keccakHex = (b: Uint8Array): Hex => toHex(keccak_256(b));

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[c & 63] : "=";
  }
  return out;
}
export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error("bad base64");
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

export function bigintToWord(v: bigint): Uint8Array {
  if (v < 0n) throw new Error("negative");
  const out = new Uint8Array(32);
  let x = v;
  for (let i = 31; i >= 0 && x > 0n; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  if (x > 0n) throw new Error("uint256 overflow");
  return out;
}
export function wordToBigint(w: Uint8Array): bigint {
  let v = 0n;
  for (const b of w) v = (v << 8n) | BigInt(b);
  return v;
}
export function addressWord(addr: string): Uint8Array {
  const out = new Uint8Array(32);
  out.set(fromHex(addr), 12);
  return out;
}
export function bytes32(hexOrText: string): Uint8Array {
  if (/^0x[0-9a-fA-F]{64}$/.test(hexOrText)) return fromHex(hexOrText);
  const out = new Uint8Array(32);
  const b = utf8ToBytes(hexOrText);
  if (b.length > 31) throw new Error("bytes32 text too long");
  out.set(b);
  return out;
}
export function bytes32ToText(b: Uint8Array): string {
  let end = b.indexOf(0);
  if (end < 0) end = b.length;
  return new TextDecoder().decode(b.subarray(0, end));
}

/* ---------- secp256k1 keys and addresses ---------- */

export function publicKeyOf(priv: Uint8Array, compressed = true): Uint8Array {
  return secp256k1.getPublicKey(priv, compressed);
}
export function addressOfPublicKey(pub: Uint8Array): Hex {
  const uncompressed = pub.length === 65 ? pub : secp256k1.ProjectivePoint.fromHex(pub).toRawBytes(false);
  return toHex(keccak(uncompressed.subarray(1)).subarray(12));
}
export function addressOfPrivateKey(priv: Uint8Array): Hex {
  return addressOfPublicKey(publicKeyOf(priv, false));
}
/** Reduce arbitrary 32 bytes into a valid private key by re-hashing on the (2^-128) miss. */
export function toValidPrivateKey(seed: Uint8Array): Uint8Array {
  let k = seed;
  while (!secp256k1.utils.isValidPrivateKey(k)) k = sha256(k);
  return k;
}

/* ---------- ECIES ---------- */

const INTENT_INFO = utf8ToBytes("tradelayer/intent/v1");
const USER_BLOB_INFO = utf8ToBytes("tradelayer/user-blob/v1");

function eciesKey(shared: Uint8Array, info: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, undefined, info, 32);
}

export type Envelope = { epk: Hex; iv: string; ct: string; tag: string };

/** Open a sealed intent. Throws on any tampering (GCM tag). */
export function openEnvelope(env: Envelope, recipientPriv: Uint8Array): Uint8Array {
  const shared = secp256k1.getSharedSecret(recipientPriv, fromHex(env.epk), true);
  const key = eciesKey(shared, INTENT_INFO);
  const sealed = concatBytes(fromBase64(env.ct), fromBase64(env.tag));
  return gcm(key, fromBase64(env.iv)).decrypt(sealed);
}

/** Seal with a caller-supplied ephemeral key (the browser uses a random one; tests a fixed one). */
export function sealEnvelope(plaintext: Uint8Array, recipientPub: Uint8Array, ephPriv: Uint8Array, iv: Uint8Array): Envelope {
  const shared = secp256k1.getSharedSecret(ephPriv, recipientPub, true);
  const key = eciesKey(shared, INTENT_INFO);
  const sealed = gcm(key, iv).encrypt(plaintext);
  return {
    epk: toHex(publicKeyOf(ephPriv, true)),
    iv: toBase64(iv),
    ct: toBase64(sealed.subarray(0, sealed.length - 16)),
    tag: toBase64(sealed.subarray(sealed.length - 16)),
  };
}

/** The on-chain commitment: keccak256 of ciphertext‖tag, exactly the bytes the enclave opens. */
export function envelopeCommit(env: Envelope): Hex {
  return keccakHex(concatBytes(fromBase64(env.ct), fromBase64(env.tag)));
}

/* ---------- ledger blobs ---------- */

const BLOB_VERSION = 1;

export function accountKey(masterKey: Uint8Array, accountId: Uint8Array): Uint8Array {
  return hkdf(sha256, masterKey, accountId, utf8ToBytes("tradelayer/account-key/v1"), 32);
}
export function orgKey(masterKey: Uint8Array, orgId: Uint8Array): Uint8Array {
  return hkdf(sha256, masterKey, orgId, utf8ToBytes("tradelayer/org-key/v1"), 32);
}

/** Deterministic nonce: the enclave must produce identical output on identical input, and each
 * (key, version, context) triple is used exactly once — the ledger's version check enforces it. */
export function blobNonce(key: Uint8Array, version: bigint, context: Uint8Array): Uint8Array {
  return hkdf(sha256, key, concatBytes(bigintToWord(version), context), utf8ToBytes("tradelayer/nonce/v1"), 12);
}

/** enclaveBlob = 0x01 ‖ nonce(12) ‖ ct‖tag */
export function encryptBlob(key: Uint8Array, plaintext: Uint8Array, version: bigint, context: Uint8Array): Uint8Array {
  const nonce = blobNonce(key, version, context);
  return concatBytes(Uint8Array.of(BLOB_VERSION), nonce, gcm(key, nonce).encrypt(plaintext));
}
export function decryptBlob(key: Uint8Array, blob: Uint8Array): Uint8Array {
  if (blob.length < 1 + 12 + 16 || blob[0] !== BLOB_VERSION) throw new Error("bad blob");
  return gcm(key, blob.subarray(1, 13)).decrypt(blob.subarray(13));
}

/** userBlob = 0x01 ‖ epk(33) ‖ nonce(12) ‖ ct‖tag, ECIES to the employee's derived public key with
 * an ephemeral key derived deterministically from the account key and version. */
export function encryptUserBlob(
  accountKey_: Uint8Array,
  userPub: Uint8Array,
  plaintext: Uint8Array,
  version: bigint,
  context: Uint8Array,
): Uint8Array {
  const ephPriv = toValidPrivateKey(
    hkdf(sha256, accountKey_, concatBytes(bigintToWord(version), context), utf8ToBytes("tradelayer/user-epk/v1"), 32),
  );
  const shared = secp256k1.getSharedSecret(ephPriv, userPub, true);
  const key = eciesKey(shared, USER_BLOB_INFO);
  const nonce = blobNonce(key, version, context);
  return concatBytes(Uint8Array.of(BLOB_VERSION), publicKeyOf(ephPriv, true), nonce, gcm(key, nonce).encrypt(plaintext));
}
export function decryptUserBlob(userPriv: Uint8Array, blob: Uint8Array): Uint8Array {
  if (blob.length < 1 + 33 + 12 + 16 || blob[0] !== BLOB_VERSION) throw new Error("bad user blob");
  const epk = blob.subarray(1, 34);
  const nonce = blob.subarray(34, 46);
  const shared = secp256k1.getSharedSecret(userPriv, epk, true);
  const key = eciesKey(shared, USER_BLOB_INFO);
  return gcm(key, nonce).decrypt(blob.subarray(46));
}

/* ---------- EIP-712 ---------- */

const DOMAIN_TYPEHASH = keccak(
  utf8ToBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
);

export function domainSeparator(name: string, version: string, chainId: bigint, verifyingContract: string): Uint8Array {
  return keccak(
    concatBytes(
      DOMAIN_TYPEHASH,
      keccak(utf8ToBytes(name)),
      keccak(utf8ToBytes(version)),
      bigintToWord(chainId),
      addressWord(verifyingContract),
    ),
  );
}

export function typedDataDigest(domainSep: Uint8Array, structHash: Uint8Array): Uint8Array {
  return keccak(concatBytes(Uint8Array.of(0x19, 0x01), domainSep, structHash));
}

/** 65-byte r‖s‖v (v ∈ {27, 28}), low-s, exactly what `ECDSA.recover` expects. */
export function signDigest(digest: Uint8Array, priv: Uint8Array): Hex {
  const sig = secp256k1.sign(digest, priv, { lowS: true });
  return toHex(concatBytes(sig.toCompactRawBytes(), Uint8Array.of(27 + sig.recovery)));
}

export function recoverAddress(digest: Uint8Array, signature: string): Hex {
  const bytes = fromHex(signature);
  if (bytes.length !== 65) throw new Error("signature must be 65 bytes");
  let v = bytes[64];
  if (v >= 27) v -= 27;
  const sig = secp256k1.Signature.fromCompact(bytes.subarray(0, 64)).addRecoveryBit(v);
  return addressOfPublicKey(sig.recoverPublicKey(digest).toRawBytes(false));
}

/* ---------- the contract-side struct set (must match packages/foundry/contracts) ---------- */

export const TYPEHASH = {
  LedgerUpdate: keccak(
    utf8ToBytes("LedgerUpdate(bytes32 accountId,bytes32 enclaveBlobHash,bytes32 userBlobHash,uint64 expectedVersion)"),
  ),
  PolicyUpdate: keccak(utf8ToBytes("PolicyUpdate(bytes32 orgId,bytes32 policyBlobHash,uint64 expectedVersion)")),
  Settlement: keccak(
    utf8ToBytes(
      "Settlement(bytes32 orderId,uint256 spent,bytes32 enclaveBlobHash,bytes32 userBlobHash,uint64 expectedVersion)",
    ),
  ),
  Cancel: keccak(utf8ToBytes("Cancel(bytes32 orderId)")),
  AtsMint: keccak(utf8ToBytes("AtsMint(bytes32 symbol,uint256 amount,uint256 expectedSupply)")),
  AtsBurn: keccak(utf8ToBytes("AtsBurn(bytes32 symbol,uint256 amount,uint256 expectedSupply)")),
  AtsTransfer: keccak(utf8ToBytes("AtsTransfer(bytes32 symbol,address to,uint256 amount,uint256 nonce)")),
  Payout: keccak(utf8ToBytes("Payout(bytes32 orgId,address to,uint256 amount,uint256 nonce)")),
} as const;

export const CONTRACT_DOMAIN = { name: "TradeLayer", version: "1" } as const;

export function structHash(typehash: Uint8Array, ...words: Uint8Array[]): Uint8Array {
  for (const w of words) if (w.length !== 32) throw new Error("struct fields must be 32-byte words");
  return keccak(concatBytes(typehash, ...words));
}

/* ---------- the employee's intent (signed by the wallet, verified in the enclave) ---------- */

export const INTENT_DOMAIN = { name: "TradeLayerIntent", version: "1" } as const;
/**
 * Note there is no `qty`. Orders are placed by **amount**, not share count: the employee says
 * "spend 20 USDC on TSLA" and the broker decides how many shares that buys. Whole shares would
 * price most of the market out of a small treasury, and a notional order also removes the need to
 * over-reserve against a moving price.
 */
export const INTENT_TYPEHASH = keccak(
  utf8ToBytes(
    "Intent(bytes32 orderId,address account,bytes32 orgId,string side,string symbol,uint256 maxSpend,uint64 expiry,uint256 nonce,bytes userPubKey)",
  ),
);

export type Intent = {
  v: 1;
  orderId: Hex;
  account: Hex;
  orgId: string;
  side: "BUY" | "SELL";
  symbol: string;
  /** USDC base units (6dp) to spend — this is the order, and the escrow reserves exactly it. */
  maxSpend: string;
  expiry: number;
  nonce: number;
  userPubKey: Hex;
  sig: Hex;
};

export function intentStructHash(i: Intent): Uint8Array {
  return structHash(
    INTENT_TYPEHASH,
    fromHex(i.orderId),
    addressWord(i.account),
    bytes32(i.orgId),
    keccak(utf8ToBytes(i.side)),
    keccak(utf8ToBytes(i.symbol)),
    bigintToWord(BigInt(i.maxSpend)),
    bigintToWord(BigInt(i.expiry)),
    bigintToWord(BigInt(i.nonce)),
    keccak(fromHex(i.userPubKey)),
  );
}

export function intentDigest(i: Intent, chainId: bigint, escrow: string): Uint8Array {
  return typedDataDigest(domainSeparator(INTENT_DOMAIN.name, INTENT_DOMAIN.version, chainId, escrow), intentStructHash(i));
}

/** ATS equities are issued with 9 decimals so fractional positions are representable on-chain. */
export const SHARE_DECIMALS = 9;
export const ONE_SHARE = 10n ** BigInt(SHARE_DECIMALS);

/** "0.054729384" -> 54729384n (9dp base units). Truncates beyond 9 places. */
export function sharesToUnits(decimal: string): bigint {
  const [whole, frac = ""] = decimal.trim().split(".");
  return BigInt(whole || "0") * ONE_SHARE + BigInt((frac + "0".repeat(SHARE_DECIMALS)).slice(0, SHARE_DECIMALS));
}

/** 54729384n -> "0.054729384", trimmed. */
export function unitsToShares(units: bigint): string {
  const whole = units / ONE_SHARE;
  const frac = (units % ONE_SHARE).toString().padStart(SHARE_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function accountIdOf(address: string): Uint8Array {
  return keccak(fromHex(address));
}

/* ---------- the org admin's policy submission (sealed, signed, opened in the enclave) ---------- */

/**
 * A policy reaches the enclave exactly the way an order does: sealed to `INTENT_PUBKEY` so no
 * intermediary can read the company's rules, and EIP-712-signed so the enclave can prove the
 * admin authored them. The verifying contract is the *vault*, because that is where
 * `orgAdmin(orgId)` — the authority being asserted — actually lives; a signature over an order
 * intent (verifying contract = escrow) can therefore never be replayed as a policy.
 */
export const POLICY_INTENT_TYPEHASH = keccak(
  utf8ToBytes("PolicyIntent(bytes32 orgId,address admin,bytes32 policyHash,uint256 nonce)"),
);

export type PolicySubmission = {
  v: 1;
  orgId: string;
  admin: Hex;
  /** The policy document, verbatim; `policyHash` below commits to this exact JSON encoding. */
  policy: unknown;
  nonce: number;
  sig: Hex;
};

/** keccak of the policy's canonical JSON — what the admin actually signs. */
export function policyHash(policy: unknown): Uint8Array {
  return keccak(utf8ToBytes(JSON.stringify(policy)));
}

export function policyIntentStructHash(p: Omit<PolicySubmission, "sig">): Uint8Array {
  return structHash(
    POLICY_INTENT_TYPEHASH,
    bytes32(p.orgId),
    addressWord(p.admin),
    policyHash(p.policy),
    bigintToWord(BigInt(p.nonce)),
  );
}

export function policyIntentDigest(p: Omit<PolicySubmission, "sig">, chainId: bigint, vault: string): Uint8Array {
  return typedDataDigest(
    domainSeparator(INTENT_DOMAIN.name, INTENT_DOMAIN.version, chainId, vault),
    policyIntentStructHash(p),
  );
}
