import { availableReceiptUnits, getPosition, recordOrder, removeOrder, type TradeSide } from "./orderStore";
import { alpaca } from "./alpacaClient";
import { atomsToShares, MIN_BUY_USDC, proportionalShareAtoms } from "./tradeUnits";

export async function createBuyOrder(
  orderId: string,
  requester: string,
  symbolInput: string,
  notionalUsdc: bigint,
) {
  const symbol = symbolInput.toUpperCase();
  if (notionalUsdc < MIN_BUY_USDC) throw new Error("Notional must be at least $1.00");

  // Alpaca notional is a dollar string with up to 2 decimals.
  const dollars = Number(notionalUsdc) / 1e6;
  const notional = dollars.toFixed(2);

  recordOrder({
    orderId,
    requester,
    symbol,
    side: "buy",
    requestAmount: notionalUsdc.toString(),
  });

  try {
    const order = await alpaca.createOrder({
      symbol,
      notional,
      side: "buy",
      type: "market",
      time_in_force: "day",
      client_order_id: orderId,
    });
    console.log("Notional buy submitted:", order.id, "| clientOrderId:", orderId, "| notional:", notional);
    return order.id;
  } catch (error) {
    removeOrder(orderId);
    throw error;
  }
}

export async function createSellOrder(
  orderId: string,
  requester: string,
  symbolInput: string,
  receiptUnits: number,
) {
  const symbol = symbolInput.toUpperCase();
  const position = getPosition(requester, symbol);
  if (!position || availableReceiptUnits(requester, symbol) < receiptUnits) {
    throw new Error(`Private portfolio has insufficient ${symbol} receipt units`);
  }

  const shareAtoms = proportionalShareAtoms(
    BigInt(position.shareAtoms),
    position.receiptUnits,
    receiptUnits,
  );
  if (shareAtoms <= 0n) throw new Error("Proportional sell quantity rounds to zero");

  const qty = atomsToShares(shareAtoms);
  recordOrder({
    orderId,
    requester,
    symbol,
    side: "sell",
    requestAmount: String(receiptUnits),
    shareAtoms: shareAtoms.toString(),
  });

  try {
    const order = await alpaca.createOrder({
      symbol,
      qty,
      side: "sell",
      type: "market",
      time_in_force: "day",
      client_order_id: orderId,
    });
    console.log("Fractional sell submitted:", order.id, "| qty:", qty, "| units:", receiptUnits);
    return order.id;
  } catch (error) {
    removeOrder(orderId);
    throw error;
  }
}

/** @deprecated Prefer createBuyOrder / createSellOrder. Kept for type exports. */
export type { TradeSide };
