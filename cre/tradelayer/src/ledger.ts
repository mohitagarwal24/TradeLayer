import { utf8ToBytes } from "@noble/hashes/utils";
import { decryptBlob, encryptBlob, encryptUserBlob, fromHex, type Hex } from "./crypto";

/**
 * Plaintext shape of an employee's private portfolio and an organization's policy. These exist
 * only inside the enclave and, for the portfolio, in the employee's own browser after decrypting
 * `userBlob`. Amounts are decimal strings: shares in whole units, cash in company-token base
 * units (6 decimals).
 */

export type OpenOrder = {
  side: "BUY" | "SELL";
  symbol: string;
  /** USDC base units the order was placed for. Share count is not known until it fills. */
  notional: string;
  escrow: string;
  brokerOrderId: string;
  placedAt: number;
};

export type Portfolio = {
  v: 1;
  cash: string;
  /** `qty` and `locked` are share counts in 9-decimal base units, matching the ATS equities. */
  positions: Record<string, { qty: string; locked: string }>;
  openOrders: Record<string, OpenOrder>;
  nonce: number;
  /** Compressed secp256k1 public key the employee derived; userBlob is encrypted to it. */
  userPubKey: Hex;
};

/**
 * The organization's rulebook. H1 currently enforces `canBuy`, `restricted` and
 * `maxOrderNotional`. `dailyCap` is carried but **not yet enforced** — enforcing it needs
 * rolling spend in the portfolio, which H2 does not yet record; `canSell` and
 * `allowWithdrawShares` are inert until the sell and withdrawal flows exist. `"0"` on any
 * numeric limit means *no limit*, so a rulebook written today cannot silently become a
 * block-everything policy the day enforcement lands.
 */
export type Policy = {
  v: 1;
  employees: Record<string, { canBuy: boolean; canSell: boolean; dailyCap: string; restricted: string[] }>;
  maxOrderNotional: string;
  allowWithdrawShares: boolean;
};

export const emptyPortfolio = (userPubKey: Hex): Portfolio => ({
  v: 1,
  cash: "0",
  positions: {},
  openOrders: {},
  nonce: 0,
  userPubKey,
});

const enc = (o: unknown) => utf8ToBytes(JSON.stringify(o));
const dec = <T>(b: Uint8Array): T => JSON.parse(new TextDecoder().decode(b)) as T;

export function decodePortfolio(accountKey: Uint8Array, enclaveBlob: Hex): Portfolio | null {
  if (!enclaveBlob || enclaveBlob === "0x") return null;
  return dec<Portfolio>(decryptBlob(accountKey, fromHex(enclaveBlob)));
}

/** Produce both blobs for the next version. `context` (e.g. the orderId) keeps nonces unique
 * even if two different updates were computed for the same version. */
export function encodePortfolio(
  accountKey: Uint8Array,
  portfolio: Portfolio,
  nextVersion: bigint,
  context: Uint8Array,
): { enclaveBlob: Uint8Array; userBlob: Uint8Array } {
  const plaintext = enc(portfolio);
  return {
    enclaveBlob: encryptBlob(accountKey, plaintext, nextVersion, context),
    userBlob: encryptUserBlob(accountKey, fromHex(portfolio.userPubKey), plaintext, nextVersion, context),
  };
}

export function decodePolicy(orgKey: Uint8Array, blob: Hex): Policy | null {
  if (!blob || blob === "0x") return null;
  return dec<Policy>(decryptBlob(orgKey, fromHex(blob)));
}

export function encodePolicy(orgKey: Uint8Array, policy: Policy, nextVersion: bigint): Uint8Array {
  return encryptBlob(orgKey, enc(policy), nextVersion, utf8ToBytes("policy"));
}
