import { formatUnits, parseUnits } from "viem";

/**
 * Product constants and the contract surface the app touches.
 *
 * There is no hardcoded institution here. Every wallet's institution is resolved at runtime from
 * OrgWalletRegistry, and contract addresses come from the backend at startup — one place to
 * configure a deployment, no generated file to keep in sync.
 */

export const BACKEND_API = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000";
export const HEDERA_TESTNET_ID = 296;
export const USDC_DECIMALS = 6;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/** Longer names for the tickers the platform has issued equities for. */
export const SYMBOL_NAMES: Record<string, string> = {
  F: "Ford Motor Company",
  TSLA: "Tesla, Inc.",
  VOO: "Vanguard S&P 500 ETF",
  AAPL: "Apple Inc.",
};

export const ORDER_STATUS = ["NONE", "OPEN", "SETTLED", "CANCELLED", "REFUNDED"] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];

/* ---------- ABIs ---------- */

export const REGISTRY_ABI = [
  { type: "function", name: "registerOrg", stateMutability: "nonpayable", inputs: [{ name: "orgId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "proposeJoin", stateMutability: "nonpayable", inputs: [{ name: "orgId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "approveJoin", stateMutability: "nonpayable", inputs: [{ name: "wallet", type: "address" }], outputs: [] },
  { type: "function", name: "revokeMembership", stateMutability: "nonpayable", inputs: [{ name: "wallet", type: "address" }], outputs: [] },
  {
    type: "function",
    name: "orgOf",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "adminOf",
    stateMutability: "view",
    inputs: [{ name: "orgId", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "event",
    name: "JoinProposed",
    inputs: [
      { name: "orgId", type: "bytes32", indexed: true },
      { name: "wallet", type: "address", indexed: true },
    ],
  },
] as const;

export const ROUTER_ABI = [
  { type: "function", name: "admitMember", stateMutability: "nonpayable", inputs: [{ name: "wallet", type: "address" }], outputs: [] },
  { type: "function", name: "revokeMember", stateMutability: "nonpayable", inputs: [{ name: "wallet", type: "address" }], outputs: [] },
  {
    type: "function",
    name: "setMemberFrozen",
    stateMutability: "nonpayable",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "frozen", type: "bool" },
    ],
    outputs: [],
  },
] as const;

export const VAULT_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [{ type: "bytes32" }],
  },
  { type: "function", name: "reserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "available", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export const ESCROW_ABI = [
  {
    type: "function",
    name: "openBuy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderId", type: "bytes32" },
      { name: "maxSpend", type: "uint256" },
      { name: "commit", type: "bytes32" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [],
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

/** HIP-719: calling `associate()` on an HTS token's address associates msg.sender with it. */
export const HTS_ASSOCIATE_ABI = [
  { type: "function", name: "associate", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

/* ---------- formatting ---------- */

export function bytes32Of(text: string): `0x${string}` {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 31) throw new Error("name too long (max 31 characters)");
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `0x${hex.padEnd(64, "0")}`;
}

export function textOfBytes32(value?: string): string {
  if (!value || !value.startsWith("0x")) return "";
  const bytes = value.slice(2).match(/.{2}/g) ?? [];
  let out = "";
  for (const b of bytes) {
    const code = parseInt(b, 16);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

/** USDC amount for display. Returns undefined-safe text so nothing ever renders as a bare dash. */
export function usd(value: bigint | undefined, digits = 2): string {
  if (value === undefined) return "—";
  return Number(formatUnits(value, USDC_DECIMALS)).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function parseUsd(input: string): bigint {
  const clean = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(clean)) throw new Error("enter an amount in USDC");
  const value = parseUnits(clean, USDC_DECIMALS);
  if (value === 0n) throw new Error("amount must be more than zero");
  return value;
}

export function money(value: number | undefined): string {
  if (value === undefined) return "—";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function short(address?: string, n = 6): string {
  if (!address) return "—";
  return `${address.slice(0, n)}…${address.slice(-4)}`;
}

export function hashscan(address: string): string {
  return `https://hashscan.io/testnet/contract/${address}`;
}
