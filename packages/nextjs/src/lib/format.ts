import { formatUnits } from "viem";

/** DSTOCK is whole-shares only (decimals = 0). */
export function fmtShares(value: bigint | number | undefined): string {
  if (value === undefined) return "0";
  return BigInt(value).toLocaleString("en-US");
}

/** USDC has 6 decimals on Base and on Hedera's native HTS USDC. */
export function fmtUsdc(value: bigint | number | undefined, decimals = 2): string {
  if (value === undefined || value === null) return "0";
  const n = Number(formatUnits(BigInt(value), 6));
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function parseUsdc(input: string): bigint {
  const cleaned = input.trim().replace(/,/g, "");
  if (!cleaned || isNaN(Number(cleaned))) return 0n;
  const [whole, frac = ""] = cleaned.split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  return BigInt(whole + fracPadded);
}

export function shortOrderId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export const STOCK_META: Record<string, { name: string; color: string }> = {
  AAPL: { name: "Apple Inc.", color: "#A2AAAD" },
  GOOGL: { name: "Alphabet Inc.", color: "#4285F4" },
  TSLA: { name: "Tesla Inc.", color: "#E82127" },
  MSFT: { name: "Microsoft Corp.", color: "#7FBA00" },
};

export function stockMeta(symbol: string) {
  return STOCK_META[symbol] ?? { name: symbol, color: "#8b5cf6" };
}

export function ts(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}
