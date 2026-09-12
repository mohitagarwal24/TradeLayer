import type { Config } from "./config";
import { type AnyRuntime, request } from "./http";
import {
  addressWord,
  bigintToWord,
  bytes32,
  CONTRACT_DOMAIN,
  domainSeparator,
  fromHex,
  keccak,
  signDigest,
  structHash,
  toHex,
  TYPEHASH,
  typedDataDigest,
  type Hex,
} from "./crypto";

/**
 * Enclave-signed authorizations. Each function builds the exact EIP-712 struct the contract
 * verifies, signs it with the enclave key, and POSTs it to the relayer. The relayer cannot alter
 * a single field without the on-chain signature check failing.
 */

export type Authorization =
  | { kind: "ledgerUpdate"; accountId: Hex; enclaveBlob: Hex; userBlob: Hex; expectedVersion: string; signature: Hex }
  | { kind: "settle"; orderId: Hex; spent: string; enclaveBlob: Hex; userBlob: Hex; expectedVersion: string; signature: Hex }
  | { kind: "cancel"; orderId: Hex; signature: Hex }
  | { kind: "policyUpdate"; orgId: string; blob: Hex; expectedVersion: string; signature: Hex }
  | { kind: "atsMint" | "atsBurn"; symbol: string; amount: string; expectedSupply: string; signature: Hex };

type Signer = { key: Uint8Array; chainId: bigint; contracts: Config["hedera"] };

function sign(signer: Signer, verifyingContract: string, sh: Uint8Array): Hex {
  const ds = domainSeparator(CONTRACT_DOMAIN.name, CONTRACT_DOMAIN.version, signer.chainId, verifyingContract);
  return signDigest(typedDataDigest(ds, sh), signer.key);
}

export function authorizeLedgerUpdate(
  signer: Signer,
  accountId: Uint8Array,
  enclaveBlob: Uint8Array,
  userBlob: Uint8Array,
  expectedVersion: bigint,
): Authorization {
  const sh = structHash(TYPEHASH.LedgerUpdate, accountId, keccak(enclaveBlob), keccak(userBlob), bigintToWord(expectedVersion));
  return {
    kind: "ledgerUpdate",
    accountId: toHex(accountId),
    enclaveBlob: toHex(enclaveBlob),
    userBlob: toHex(userBlob),
    expectedVersion: expectedVersion.toString(),
    signature: sign(signer, signer.contracts.ledger, sh),
  };
}

export function authorizeSettlement(
  signer: Signer,
  orderId: Hex,
  spent: bigint,
  enclaveBlob: Uint8Array,
  userBlob: Uint8Array,
  expectedVersion: bigint,
): Authorization {
  const sh = structHash(
    TYPEHASH.Settlement,
    fromHex(orderId),
    bigintToWord(spent),
    keccak(enclaveBlob),
    keccak(userBlob),
    bigintToWord(expectedVersion),
  );
  return {
    kind: "settle",
    orderId,
    spent: spent.toString(),
    enclaveBlob: toHex(enclaveBlob),
    userBlob: toHex(userBlob),
    expectedVersion: expectedVersion.toString(),
    signature: sign(signer, signer.contracts.escrow, sh),
  };
}

export function authorizePolicyUpdate(
  signer: Signer,
  orgId: string,
  blob: Uint8Array,
  expectedVersion: bigint,
): Authorization {
  const sh = structHash(TYPEHASH.PolicyUpdate, bytes32(orgId), keccak(blob), bigintToWord(expectedVersion));
  return {
    kind: "policyUpdate",
    orgId,
    blob: toHex(blob),
    expectedVersion: expectedVersion.toString(),
    signature: sign(signer, signer.contracts.ledger, sh),
  };
}

export function authorizeCancel(signer: Signer, orderId: Hex): Authorization {
  const sh = structHash(TYPEHASH.Cancel, fromHex(orderId));
  return { kind: "cancel", orderId, signature: sign(signer, signer.contracts.escrow, sh) };
}

export function authorizeAtsDelta(
  signer: Signer,
  kind: "atsMint" | "atsBurn",
  symbol: string,
  amount: bigint,
  expectedSupply: bigint,
): Authorization {
  const sh = structHash(
    kind === "atsMint" ? TYPEHASH.AtsMint : TYPEHASH.AtsBurn,
    bytes32(symbol),
    bigintToWord(amount),
    bigintToWord(expectedSupply),
  );
  return {
    kind,
    symbol,
    amount: amount.toString(),
    expectedSupply: expectedSupply.toString(),
    signature: sign(signer, signer.contracts.vault, sh),
  };
}

export type RelayResult = { status: string; txHash?: string; error?: string };

export function relay<C>(runtime: AnyRuntime<C>, relayerUrl: string, auth: Authorization, token?: string): RelayResult {
  const res = request(runtime, {
    url: relayerUrl,
    method: "POST",
    body: auth,
    // The relayer is publicly reachable once hosted and every call it accepts costs HBAR. This
    // does not replace the on-chain signature check — a forged authorization still dies at the
    // contract — it just stops a passer-by burning the relayer's gas on rejections.
    ...(token ? { headers: { "x-tradelayer-relay-token": token } } : {}),
  });
  const body = (() => {
    try {
      return res.json() as RelayResult;
    } catch {
      return { status: "failed", error: res.text.slice(0, 200) };
    }
  })();
  if (res.status >= 300 && body.status !== "confirmed") {
    return { status: "failed", error: body.error ?? `relayer HTTP ${res.status}` };
  }
  return body;
}

// Re-exported so handlers can build the address word for `to` fields without importing crypto.
export { addressWord };
