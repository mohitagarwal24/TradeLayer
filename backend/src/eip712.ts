import { TypedDataEncoder, encodeBytes32String, getAddress, isHexString, keccak256, verifyTypedData } from "ethers";
import { z } from "zod";

/**
 * The authorization protocol between the enclave and the chain.
 *
 * The enclave signs one of these EIP-712 structs; the relayer submits it; the contract recovers
 * the signer. Field names and type strings here MUST match the TYPEHASH constants in
 * packages/foundry/contracts — the tests there pin the Solidity side, and `digestFor` below is
 * cross-checked against `domainSeparator()` at relayer startup.
 */

export const EIP712_TYPES = {
  LedgerUpdate: [
    { name: "accountId", type: "bytes32" },
    { name: "enclaveBlobHash", type: "bytes32" },
    { name: "userBlobHash", type: "bytes32" },
    { name: "expectedVersion", type: "uint64" },
  ],
  PolicyUpdate: [
    { name: "orgId", type: "bytes32" },
    { name: "policyBlobHash", type: "bytes32" },
    { name: "expectedVersion", type: "uint64" },
  ],
  Settlement: [
    { name: "orderId", type: "bytes32" },
    { name: "spent", type: "uint256" },
    { name: "enclaveBlobHash", type: "bytes32" },
    { name: "userBlobHash", type: "bytes32" },
    { name: "expectedVersion", type: "uint64" },
  ],
  Cancel: [{ name: "orderId", type: "bytes32" }],
  AtsMint: [
    { name: "symbol", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "expectedSupply", type: "uint256" },
  ],
  AtsBurn: [
    { name: "symbol", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "expectedSupply", type: "uint256" },
  ],
  AtsTransfer: [
    { name: "symbol", type: "bytes32" },
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
  Payout: [
    { name: "orgId", type: "bytes32" },
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export function domainFor(chainId: number, verifyingContract: string) {
  return { name: "TradeLayer", version: "1", chainId, verifyingContract };
}

/* ---------- wire schema: what the enclave POSTs to /relay ---------- */

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/, "0x-hex expected");
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "bytes32 expected");
const uint = z.string().regex(/^\d+$/, "decimal integer string expected");
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
/** Ticker as plain text ("TSLA") or already-encoded bytes32. */
const symbol = z.union([bytes32, z.string().min(1).max(31)]);

export const authorizationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ledgerUpdate"),
    accountId: bytes32,
    enclaveBlob: hex,
    userBlob: hex,
    expectedVersion: uint,
    signature: hex,
  }),
  z.object({
    kind: z.literal("policyUpdate"),
    orgId: symbol,
    blob: hex,
    expectedVersion: uint,
    signature: hex,
  }),
  z.object({
    kind: z.literal("settle"),
    orderId: bytes32,
    spent: uint,
    enclaveBlob: hex,
    userBlob: hex,
    expectedVersion: uint,
    signature: hex,
  }),
  z.object({ kind: z.literal("cancel"), orderId: bytes32, signature: hex }),
  z.object({ kind: z.literal("atsMint"), symbol, amount: uint, expectedSupply: uint, signature: hex }),
  z.object({ kind: z.literal("atsBurn"), symbol, amount: uint, expectedSupply: uint, signature: hex }),
  z.object({ kind: z.literal("atsTransfer"), symbol, to: address, amount: uint, nonce: uint, signature: hex }),
  z.object({ kind: z.literal("payout"), orgId: symbol, to: address, amount: uint, nonce: uint, signature: hex }),
]);

export type Authorization = z.infer<typeof authorizationSchema>;

export function toBytes32(value: string): string {
  return isHexString(value, 32) ? value : encodeBytes32String(value);
}

/** Which contract an authorization targets and the EIP-712 primary type + value it encodes. */
export function describe(auth: Authorization): {
  target: "escrow" | "ledger" | "vault";
  primaryType: keyof typeof EIP712_TYPES;
  value: Record<string, unknown>;
} {
  switch (auth.kind) {
    case "ledgerUpdate":
      return {
        target: "ledger",
        primaryType: "LedgerUpdate",
        value: {
          accountId: auth.accountId,
          enclaveBlobHash: keccak256(auth.enclaveBlob),
          userBlobHash: keccak256(auth.userBlob),
          expectedVersion: auth.expectedVersion,
        },
      };
    case "policyUpdate":
      return {
        target: "ledger",
        primaryType: "PolicyUpdate",
        value: { orgId: toBytes32(auth.orgId), policyBlobHash: keccak256(auth.blob), expectedVersion: auth.expectedVersion },
      };
    case "settle":
      return {
        target: "escrow",
        primaryType: "Settlement",
        value: {
          orderId: auth.orderId,
          spent: auth.spent,
          enclaveBlobHash: keccak256(auth.enclaveBlob),
          userBlobHash: keccak256(auth.userBlob),
          expectedVersion: auth.expectedVersion,
        },
      };
    case "cancel":
      return { target: "escrow", primaryType: "Cancel", value: { orderId: auth.orderId } };
    case "atsMint":
      return {
        target: "vault",
        primaryType: "AtsMint",
        value: { symbol: toBytes32(auth.symbol), amount: auth.amount, expectedSupply: auth.expectedSupply },
      };
    case "atsBurn":
      return {
        target: "vault",
        primaryType: "AtsBurn",
        value: { symbol: toBytes32(auth.symbol), amount: auth.amount, expectedSupply: auth.expectedSupply },
      };
    case "atsTransfer":
      return {
        target: "vault",
        primaryType: "AtsTransfer",
        value: { symbol: toBytes32(auth.symbol), to: getAddress(auth.to), amount: auth.amount, nonce: auth.nonce },
      };
    case "payout":
      return {
        target: "vault",
        primaryType: "Payout",
        value: { orgId: toBytes32(auth.orgId), to: getAddress(auth.to), amount: auth.amount, nonce: auth.nonce },
      };
  }
}

export function digestFor(auth: Authorization, chainId: number, verifyingContract: string): string {
  const { primaryType, value } = describe(auth);
  return TypedDataEncoder.hash(domainFor(chainId, verifyingContract), { [primaryType]: [...EIP712_TYPES[primaryType]] }, value);
}

/** Recover the signer of an authorization. Returns the checksummed address. */
export function recoverSigner(auth: Authorization, chainId: number, verifyingContract: string): string {
  const { primaryType, value } = describe(auth);
  return verifyTypedData(
    domainFor(chainId, verifyingContract),
    { [primaryType]: [...EIP712_TYPES[primaryType]] },
    value,
    auth.signature,
  );
}
