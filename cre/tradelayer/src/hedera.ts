import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";
import type { Config } from "./config";
import { type AnyRuntime, request } from "./http";
import { bytes32, toHex } from "./crypto";

/**
 * Read-only access to the TradeLayer contracts on Hedera via JSON-RPC `eth_call`.
 * Hedera is not a CRE-supported chain, so the EVM capability is not available; the relay is
 * just another HTTPS endpoint from the enclave's point of view.
 */

const ESCROW_ABI = parseAbi([
  "function order(bytes32 orderId) view returns ((address requester, bytes32 accountId, bytes32 orgId, uint256 amount, bytes32 commit, uint64 expiry, uint8 status, address schedule))",
  "function openOrders(uint256 start, uint256 count) view returns (bytes32[])",
  "function openCount() view returns (uint256)",
]);

const LEDGER_ABI = parseAbi([
  "function entry(bytes32 accountId) view returns ((bytes enclaveBlob, bytes userBlob, uint64 version, bytes32 blobHash))",
  "function policy(bytes32 orgId) view returns ((bytes blob, uint64 version))",
]);

const VAULT_ABI = parseAbi([
  "function atsSupply(bytes32 symbol) view returns (uint256)",
  "function atsToken(bytes32 symbol) view returns (address)",
]);
const ERC20_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

const REGISTRY_ABI = parseAbi([
  "function orgOf(address wallet) view returns (bytes32)",
  "function adminOf(bytes32 orgId) view returns (address)",
]);

export enum OrderStatus {
  NONE = 0,
  OPEN = 1,
  SETTLED = 2,
  CANCELLED = 3,
  REFUNDED = 4,
}

export type EscrowOrder = {
  requester: Hex;
  accountId: Hex;
  /** Resolved from OrgWalletRegistry when the order opened — never from the intent. */
  orgId: Hex;
  amount: bigint;
  commit: Hex;
  expiry: bigint;
  status: OrderStatus;
  schedule: Hex;
};

export type LedgerEntry = { enclaveBlob: Hex; userBlob: Hex; version: bigint; blobHash: Hex };

function ethCall<C>(runtime: AnyRuntime<C>, rpcUrl: string, to: string, data: Hex): Hex {
  const res = request(runtime, {
    url: rpcUrl,
    method: "POST",
    body: { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] },
  });
  if (res.status >= 300) throw new Error(`eth_call HTTP ${res.status}`);
  const body = res.json() as { result?: Hex; error?: { message: string } };
  if (body.error) throw new Error(`eth_call: ${body.error.message}`);
  if (!body.result) throw new Error("eth_call: empty result");
  return body.result;
}

export function readOrder<C>(runtime: AnyRuntime<C>, cfg: Config["hedera"], orderId: Hex): EscrowOrder {
  const data = encodeFunctionData({ abi: ESCROW_ABI, functionName: "order", args: [orderId] });
  const out = decodeFunctionResult({ abi: ESCROW_ABI, functionName: "order", data: ethCall(runtime, cfg.rpcUrl, cfg.escrow, data) });
  return { ...out, status: Number(out.status) as OrderStatus } as EscrowOrder;
}

export function readOpenOrders<C>(runtime: AnyRuntime<C>, cfg: Config["hedera"], start: bigint, count: bigint): Hex[] {
  const data = encodeFunctionData({ abi: ESCROW_ABI, functionName: "openOrders", args: [start, count] });
  return [...decodeFunctionResult({ abi: ESCROW_ABI, functionName: "openOrders", data: ethCall(runtime, cfg.rpcUrl, cfg.escrow, data) })];
}

export function readEntry<C>(runtime: AnyRuntime<C>, cfg: Config["hedera"], accountId: Hex): LedgerEntry {
  const data = encodeFunctionData({ abi: LEDGER_ABI, functionName: "entry", args: [accountId] });
  return decodeFunctionResult({ abi: LEDGER_ABI, functionName: "entry", data: ethCall(runtime, cfg.rpcUrl, cfg.ledger, data) }) as LedgerEntry;
}

export function readPolicy<C>(runtime: AnyRuntime<C>, cfg: Config["hedera"], orgId: string): { blob: Hex; version: bigint } {
  const data = encodeFunctionData({ abi: LEDGER_ABI, functionName: "policy", args: [toHex(bytes32(orgId))] });
  return decodeFunctionResult({ abi: LEDGER_ABI, functionName: "policy", data: ethCall(runtime, cfg.rpcUrl, cfg.ledger, data) });
}

/**
 * Which institution a wallet actually belongs to. The intent carries an `orgId` field, but it is
 * user-supplied and therefore unauthenticated — trusting it would let someone evaluate their
 * order against a different institution's private rules. Always resolve here instead.
 */
export function readOrgOf<C>(runtime: AnyRuntime<C>, cfg: Config["hedera"], wallet: string): Hex {
  const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: "orgOf", args: [wallet as Hex] });
  return decodeFunctionResult({
    abi: REGISTRY_ABI,
    functionName: "orgOf",
    data: ethCall(runtime, cfg.rpcUrl, cfg.registry, data),
  });
}

/** The only authority that may set an institution's policy. Read from chain, never taken on trust. */
export function readOrgAdmin<C>(runtime: AnyRuntime<C>, cfg: Config["hedera"], orgId: string): Hex {
  const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: "adminOf", args: [toHex(bytes32(orgId))] });
  return decodeFunctionResult({
    abi: REGISTRY_ABI,
    functionName: "adminOf",
    data: ethCall(runtime, cfg.rpcUrl, cfg.registry, data),
  });
}

export function readAtsSupply<C>(runtime: AnyRuntime<C>, cfg: Config["hedera"], symbol: string): bigint {
  const data = encodeFunctionData({ abi: VAULT_ABI, functionName: "atsSupply", args: [toHex(bytes32(symbol))] });
  return decodeFunctionResult({ abi: VAULT_ABI, functionName: "atsSupply", data: ethCall(runtime, cfg.rpcUrl, cfg.vault, data) });
}

/** How much of an equity the omnibus actually holds — the ceiling on what a batch can burn. */
export function readAtsVaultBalance<C>(runtime: AnyRuntime<C>, cfg: Config["hedera"], symbol: string): bigint {
  const token = cfg.symbols[symbol];
  if (!token) throw new Error(`unknown symbol ${symbol}`);
  const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "balanceOf", args: [cfg.vault as Hex] });
  return decodeFunctionResult({ abi: ERC20_ABI, functionName: "balanceOf", data: ethCall(runtime, cfg.rpcUrl, token, data) });
}
