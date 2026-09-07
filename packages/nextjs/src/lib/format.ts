import { formatUnits } from "viem";

/** One integer DSTOCK unit = $0.01 of deposited portfolio value (100 units = $1.00). */
export const USDC_PER_CENT = 10_000n;
export const RECEIPT_UNITS_PER_DOLLAR = 100;
export const MIN_BUY_USDC = 1; // dollars

export function fmtReceiptValue(units: bigint | number | undefined): string {
  if (units === undefined) return "$0.00";
  const cents = Number(units);
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtReceiptUnits(units: bigint | number | undefined): string {
  if (units === undefined) return "0";
  return Number(units).toLocaleString("en-US");
}

/** Parse a dollar string like "5.00" into integer receipt units (cents). */
export function parseReceiptUnits(value: string): bigint {
  const dollars = Number(value);
  if (!Number.isFinite(dollars) || dollars <= 0) return 0n;
  const cents = Math.round(dollars * 100);
  if (Math.abs(cents / 100 - dollars) > 1e-8) return 0n;
  return BigInt(cents);
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
  const amount = BigInt(whole + fracPadded);
  // Require whole-cent amounts (Alpaca notional + on-chain rule).
  if (amount % USDC_PER_CENT !== 0n) return 0n;
  return amount;
}

export function shortOrderId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export const STOCK_META: Record<string, { name: string; color: string }> = {
  TSLA: { name: "Tesla Inc.", color: "#E82127" },
  VOO: { name: "Vanguard S&P 500 ETF", color: "#C41230" },
  QQQ: { name: "Invesco QQQ Trust", color: "#0057B8" },
};

export function stockMeta(symbol: string) {
  return STOCK_META[symbol] ?? { name: symbol, color: "#8b5cf6" };
}

export function ts(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

/** @deprecated Use fmtReceiptValue — kept for transitional imports. */
export const fmtShares = fmtReceiptValue;
/** @deprecated Use parseReceiptUnits. */
export const parseShareUnits = parseReceiptUnits;
export const DSTOCK_UNITS_PER_SHARE = RECEIPT_UNITS_PER_DOLLAR;
