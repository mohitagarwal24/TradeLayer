import fs from "node:fs";
import path from "node:path";

export type TradeSide = "buy" | "sell";

export type PrivateOrder = {
  orderId: string;
  requester: string;
  symbol: string;
  side: TradeSide;
  /** Buy: USDC base units (notional). Sell: receipt units to burn. */
  requestAmount: string;
  /** Sell only: share atoms to sell (proportional). */
  shareAtoms?: string;
};

export type PrivatePosition = {
  /** Integer share atoms (1e9 = 1 share). */
  shareAtoms: string;
  /** Deposited-value receipt units attributed to this symbol. */
  receiptUnits: number;
};

type PrivateLedger = {
  version: 2;
  orders: Record<string, PrivateOrder>;
  positions: Record<string, Record<string, PrivatePosition>>;
  executions: Record<string, Record<string, string | number>>;
};

const ledgerPath = path.resolve(process.env.PRIVATE_LEDGER_PATH ?? ".data/private-ledger.json");
let ledger: PrivateLedger = { version: 2, orders: {}, positions: {}, executions: {} };

try {
  if (fs.existsSync(ledgerPath)) {
    const loaded = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as Partial<PrivateLedger> & {
      positions?: Record<string, unknown>;
    };
    ledger = {
      version: 2,
      orders: (loaded.orders as PrivateLedger["orders"]) ?? {},
      positions: {},
      executions: (loaded.executions as PrivateLedger["executions"]) ?? {},
    };
    // Migrate v1 number balances → leave empty (demo ledger; no live positions yet).
    if (loaded.version === 2 && loaded.positions) {
      ledger.positions = loaded.positions as PrivateLedger["positions"];
    }
  }
} catch (error) {
  throw new Error(`Could not load private portfolio ledger: ${(error as Error).message}`);
}

function persist() {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), { mode: 0o600 });
}

export function recordOrder(order: PrivateOrder) {
  ledger.orders[order.orderId] = order;
  persist();
}

export function getOrder(orderId: string) {
  return ledger.orders[orderId];
}

export function hasOrder(orderId: string) {
  return orderId in ledger.orders;
}

export function getPendingOrders() {
  return Object.values(ledger.orders);
}

export function removeOrder(orderId: string) {
  delete ledger.orders[orderId];
  persist();
}

export function recordExecutionProof(orderId: string, proof: Record<string, string | number>) {
  ledger.executions[orderId] = { ...(ledger.executions[orderId] ?? {}), ...proof };
  persist();
}

export function getPrivatePositions(address: string) {
  return { ...(ledger.positions[address.toLowerCase()] ?? {}) };
}

export function getPosition(address: string, symbol: string): PrivatePosition | undefined {
  return ledger.positions[address.toLowerCase()]?.[symbol.toUpperCase()];
}

export function availableReceiptUnits(address: string, symbol: string) {
  return getPosition(address, symbol)?.receiptUnits ?? 0;
}

export function applyFilledBuy(
  orderId: string,
  filledShareAtoms: bigint,
  receiptUnits: number,
) {
  const order = ledger.orders[orderId];
  if (!order || order.side !== "buy") throw new Error(`Unknown buy order ${orderId}`);
  if (filledShareAtoms <= 0n || !Number.isSafeInteger(receiptUnits) || receiptUnits <= 0) {
    throw new Error("Buy fill must add positive share atoms and receipt units");
  }

  const address = order.requester.toLowerCase();
  const symbol = order.symbol.toUpperCase();
  const positions = (ledger.positions[address] ??= {});
  const current = positions[symbol] ?? { shareAtoms: "0", receiptUnits: 0 };
  positions[symbol] = {
    shareAtoms: (BigInt(current.shareAtoms) + filledShareAtoms).toString(),
    receiptUnits: current.receiptUnits + receiptUnits,
  };
  delete ledger.orders[orderId];
  persist();
}

export function applyFilledSell(orderId: string, burnedReceiptUnits: number, soldShareAtoms: bigint) {
  const order = ledger.orders[orderId];
  if (!order || order.side !== "sell") throw new Error(`Unknown sell order ${orderId}`);
  if (!Number.isSafeInteger(burnedReceiptUnits) || burnedReceiptUnits <= 0 || soldShareAtoms <= 0n) {
    throw new Error("Sell fill must burn positive receipt units and share atoms");
  }

  const address = order.requester.toLowerCase();
  const symbol = order.symbol.toUpperCase();
  const positions = ledger.positions[address];
  const current = positions?.[symbol];
  if (!current) throw new Error(`Private ledger has no ${symbol} position`);
  if (current.receiptUnits < burnedReceiptUnits) throw new Error(`Insufficient ${symbol} receipt units`);
  const remainingAtoms = BigInt(current.shareAtoms) - soldShareAtoms;
  if (remainingAtoms < 0n) throw new Error(`Insufficient ${symbol} share atoms`);

  const remainingUnits = current.receiptUnits - burnedReceiptUnits;
  if (remainingUnits === 0) {
    if (remainingAtoms !== 0n) throw new Error("Share atoms remain after full unit redemption");
    delete positions[symbol];
  } else {
    positions[symbol] = {
      shareAtoms: remainingAtoms.toString(),
      receiptUnits: remainingUnits,
    };
  }
  delete ledger.orders[orderId];
  persist();
}
