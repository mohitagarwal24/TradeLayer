/**
 * Browser side of TradeLayer's order-privacy scheme. Byte-for-byte compatible with
 * cre/tradelayer/src/crypto.ts — the enclave is the only party that can open what this seals,
 * and this is the only party that can read what the enclave writes back for the employee.
 *
 *   sealIntent        ECIES(secp256k1 → enclave INTENT_PUBKEY) + AES-256-GCM, random ephemeral key
 *   envelopeCommit    keccak256(ct‖tag) — goes on-chain with the escrow
 *   portfolioKey      keccak256(personal_sign("TradeLayer portfolio key v1")) → secp256k1 key
 *   decryptUserBlob   opens the enclave-written portfolio copy with that key
 *   intentTypedData   EIP-712 payload for wallet.signTypedData — verified inside the enclave
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { gcm } from "@noble/ciphers/aes";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

export type Hex = `0x${string}`;
export type Envelope = { epk: Hex; iv: string; ct: string; tag: string };

export type Intent = {
  v: 1;
  orderId: Hex;
  account: Hex;
  orgId: string;
  side: "BUY" | "SELL";
  symbol: string;
  /** USDC base units (6dp) to spend. Orders are placed by amount; the fill decides the shares. */
  maxSpend: string;
  expiry: number;
  nonce: number;
  userPubKey: Hex;
  sig: Hex;
};

export type Portfolio = {
  v: 1;
  cash: string;
  /** Share counts in 9-decimal base units, matching the ATS equities. */
  positions: Record<string, { qty: string; locked: string }>;
  openOrders: Record<
    string,
    { side: "BUY" | "SELL"; symbol: string; notional: string; escrow: string; brokerOrderId: string; placedAt: number }
  >;
  nonce: number;
  userPubKey: Hex;
};

/** ATS equities are issued with 9 decimals so fractional positions are representable. */
export const SHARE_DECIMALS = 9;
export const ONE_SHARE = 10n ** BigInt(SHARE_DECIMALS);

/** 54729384n -> "0.054729384". Must match `unitsToShares` in cre/tradelayer/src/crypto.ts. */
export function unitsToShares(units: bigint): string {
  const whole = units / ONE_SHARE;
  const frac = (units % ONE_SHARE).toString().padStart(SHARE_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

const toHex = (b: Uint8Array): Hex => `0x${bytesToHex(b)}`;
const fromHex = (h: string): Uint8Array => hexToBytes(h.startsWith("0x") ? h.slice(2) : h);

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
}

const INTENT_INFO = utf8ToBytes("tradelayer/intent/v1");
const USER_BLOB_INFO = utf8ToBytes("tradelayer/user-blob/v1");

/* ---------- sealing ---------- */

/** ECIES to the enclave's key. Shared by orders and policies — both are things only the enclave
 * may read, and both travel through servers that must not be able to. */
function sealJson(value: unknown, enclavePubKey: Hex): Envelope {
  const ephPriv = secp256k1.utils.randomPrivateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const shared = secp256k1.getSharedSecret(ephPriv, fromHex(enclavePubKey), true);
  const key = hkdf(sha256, shared, undefined, INTENT_INFO, 32);
  const sealed = gcm(key, iv).encrypt(utf8ToBytes(JSON.stringify(value)));
  return {
    epk: toHex(secp256k1.getPublicKey(ephPriv, true)),
    iv: toBase64(iv),
    ct: toBase64(sealed.subarray(0, sealed.length - 16)),
    tag: toBase64(sealed.subarray(sealed.length - 16)),
  };
}

export function sealIntent(intent: Intent, enclavePubKey: Hex): { envelope: Envelope; commit: Hex } {
  const envelope = sealJson(intent, enclavePubKey);
  return { envelope, commit: envelopeCommit(envelope) };
}

export function sealPolicy(submission: PolicySubmission, enclavePubKey: Hex): Envelope {
  return sealJson(submission, enclavePubKey);
}

export function envelopeCommit(env: Envelope): Hex {
  return toHex(keccak_256(concatBytes(fromBase64(env.ct), fromBase64(env.tag))));
}

/* ---------- the employee's portfolio key ---------- */

export const PORTFOLIO_KEY_MESSAGE = "TradeLayer portfolio key v1";

/** Derive the employee's encryption key from a wallet signature over a fixed message. The wallet
 * never exposes its private key; this derived key is deterministic and recoverable. */
export function portfolioKeyFromSignature(signature: Hex): { privateKey: Uint8Array; publicKey: Hex } {
  let k = keccak_256(fromHex(signature));
  while (!secp256k1.utils.isValidPrivateKey(k)) k = sha256(k);
  return { privateKey: k, publicKey: toHex(secp256k1.getPublicKey(k, true)) };
}

export function decryptUserBlob(privateKey: Uint8Array, blobHex: Hex): Portfolio | null {
  if (!blobHex || blobHex === "0x") return null;
  const blob = fromHex(blobHex);
  if (blob.length < 1 + 33 + 12 + 16 || blob[0] !== 1) throw new Error("bad user blob");
  const epk = blob.subarray(1, 34);
  const nonce = blob.subarray(34, 46);
  const shared = secp256k1.getSharedSecret(privateKey, epk, true);
  const key = hkdf(sha256, shared, undefined, USER_BLOB_INFO, 32);
  const plaintext = gcm(key, nonce).decrypt(blob.subarray(46));
  return JSON.parse(new TextDecoder().decode(plaintext)) as Portfolio;
}

/* ---------- ids ---------- */

export function newOrderId(account: Hex, nonce: number): Hex {
  const salt = crypto.getRandomValues(new Uint8Array(8));
  return toHex(keccak_256(concatBytes(fromHex(account), utf8ToBytes(String(nonce)), salt)));
}

export function accountIdOf(account: Hex): Hex {
  return toHex(keccak_256(fromHex(account)));
}

/* ---------- EIP-712 intent for wallet.signTypedData ---------- */

export const INTENT_TYPES = {
  Intent: [
    { name: "orderId", type: "bytes32" },
    { name: "account", type: "address" },
    { name: "orgId", type: "bytes32" },
    { name: "side", type: "string" },
    { name: "symbol", type: "string" },
    { name: "maxSpend", type: "uint256" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "userPubKey", type: "bytes" },
  ],
} as const;

export function orgIdBytes32(orgId: string): Hex {
  if (/^0x[0-9a-fA-F]{64}$/.test(orgId)) return orgId as Hex;
  const out = new Uint8Array(32);
  out.set(utf8ToBytes(orgId));
  return toHex(out);
}

/* ---------- the org admin's policy (sealed like an order, signed like an intent) ---------- */

export type PolicyRule = { canBuy: boolean; canSell: boolean; dailyCap: string; restricted: string[] };
export type Policy = {
  v: 1;
  /** Keys must be lowercased wallet addresses — the enclave looks employees up that way. */
  employees: Record<string, PolicyRule>;
  maxOrderNotional: string;
  allowWithdrawShares: boolean;
};

export type PolicySubmission = { v: 1; orgId: string; admin: Hex; policy: Policy; nonce: number; sig: Hex };

export const POLICY_INTENT_TYPES = {
  PolicyIntent: [
    { name: "orgId", type: "bytes32" },
    { name: "admin", type: "address" },
    { name: "policyHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

/** keccak of the policy's canonical JSON — must match `policyHash` in cre/tradelayer/src/crypto.ts. */
export function policyHash(policy: Policy): Hex {
  return toHex(keccak_256(utf8ToBytes(JSON.stringify(policy))));
}

/**
 * The verifying contract is the **vault**, not the escrow: the authority being asserted is
 * `orgAdmin(orgId)`, which lives there. That also means an order signature can never be replayed
 * as a policy, or the reverse.
 */
export function policyTypedData(submission: Omit<PolicySubmission, "sig">, chainId: number, vault: Hex) {
  return {
    domain: { name: "TradeLayerIntent", version: "1", chainId, verifyingContract: vault },
    types: POLICY_INTENT_TYPES,
    primaryType: "PolicyIntent" as const,
    message: {
      orgId: orgIdBytes32(submission.orgId),
      admin: submission.admin,
      policyHash: policyHash(submission.policy),
      nonce: BigInt(submission.nonce),
    },
  };
}

export function intentTypedData(intent: Omit<Intent, "sig">, chainId: number, escrow: Hex) {
  return {
    domain: { name: "TradeLayerIntent", version: "1", chainId, verifyingContract: escrow },
    types: INTENT_TYPES,
    primaryType: "Intent" as const,
    message: {
      orderId: intent.orderId,
      account: intent.account,
      orgId: orgIdBytes32(intent.orgId),
      side: intent.side,
      symbol: intent.symbol,
      maxSpend: BigInt(intent.maxSpend),
      expiry: BigInt(intent.expiry),
      nonce: BigInt(intent.nonce),
      userPubKey: intent.userPubKey,
    },
  };
}
