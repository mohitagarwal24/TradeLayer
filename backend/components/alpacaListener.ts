import { handleTradeCancellation, handleTradeSettlement } from "./contractCalls";
import {
  applyFilledBuy,
  applyFilledSell,
  getOrder,
  getPendingOrders,
  hasOrder,
  recordExecutionProof,
  removeOrder,
} from "./orderStore";
import { AbiCoder, ethers, keccak256 } from "ethers";
import { randomBytes } from "node:crypto";
import { alpaca } from "./alpacaClient";
import { contract } from "./contract";
import { assertFillNearBenchmark, getPythBenchmark } from "./pythOracle";
import { sharesToAtoms, usdcToReceiptUnits, USDC_PER_CENT } from "./tradeUnits";

const abi = new AbiCoder();

function roundDownToCent(usdc: bigint): bigint {
  return (usdc / USDC_PER_CENT) * USDC_PER_CENT;
}

type AlpacaOrder = {
  client_order_id: string;
  symbol: string;
  side: "buy" | "sell";
  status: string;
  filled_qty: string;
  filled_avg_price: string | null;
};

const processing = new Set<string>();

async function retryRpc<T>(operation: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === 4) break;
      const waitMs = attempt * 2_000;
      console.warn(`${label} failed (attempt ${attempt}/4); retrying in ${waitMs}ms`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

async function settleFilledOrder(order: AlpacaOrder) {
  const orderId = order.client_order_id;
  if (!hasOrder(orderId) || processing.has(orderId)) return;
  processing.add(orderId);

  try {
    console.log(`Reconciling filled Alpaca order ${orderId}`);
    const privateOrder = getOrder(orderId);
    if (!privateOrder) return;
    const isBuy = privateOrder.side === "buy";
    const filledShares = Number(order.filled_qty);
    const filledShareAtoms = sharesToAtoms(filledShares);
    const fillPrice = Number(order.filled_avg_price);
    if (order.symbol !== privateOrder.symbol || order.side !== privateOrder.side) {
      throw new Error("Alpaca fill does not match the private order");
    }

    const benchmark = await getPythBenchmark(privateOrder.symbol);
    const deviationBps = assertFillNearBenchmark(fillPrice, benchmark);
    const fillPriceUsdc = ethers.parseUnits(fillPrice.toFixed(6), 6);

    let dstockUnits: number;
    let amountToRefund: bigint;
    let ledgerShareAtoms = filledShareAtoms;

    if (isBuy) {
      const req = await retryRpc(() => contract.requests(orderId), "Read Hedera escrow");
      const escrowedUsdc = BigInt(req[1]);
      const grossSpent = (fillPriceUsdc * filledShareAtoms) / 1_000_000_000n;
      if (grossSpent > escrowedUsdc) {
        throw new Error("Alpaca fill exceeds this order's USDC escrow");
      }
      amountToRefund = roundDownToCent(escrowedUsdc - grossSpent);
      const netSpent = escrowedUsdc - amountToRefund;
      if (netSpent < 1_000_000n) throw new Error("Net spend below $1 after refund rounding");
      dstockUnits = usdcToReceiptUnits(netSpent);
    } else {
      dstockUnits = Number(privateOrder.requestAmount);
      if (!Number.isSafeInteger(dstockUnits) || dstockUnits <= 0) {
        throw new Error("Sell order missing receipt units");
      }
      const expectedAtoms = BigInt(privateOrder.shareAtoms ?? "0");
      const atomDifference =
        filledShareAtoms >= expectedAtoms
          ? filledShareAtoms - expectedAtoms
          : expectedAtoms - filledShareAtoms;
      if (atomDifference > 1n) {
        throw new Error(
          `Sell fill atoms ${filledShareAtoms} do not match planned ${expectedAtoms}`,
        );
      }
      // The private ledger debits the exact proportional quantity submitted.
      ledgerShareAtoms = expectedAtoms;
      amountToRefund = (fillPriceUsdc * filledShareAtoms) / 1_000_000_000n;
    }

    const salt = `0x${randomBytes(32).toString("hex")}`;
    const executionCommitment = keccak256(
      abi.encode(
        ["string", "string", "uint256", "uint256", "uint256", "uint256", "uint256", "bytes32"],
        [
          orderId,
          privateOrder.symbol,
          dstockUnits,
          fillPriceUsdc,
          amountToRefund,
          ethers.parseUnits(benchmark.price.toFixed(6), 6),
          benchmark.publishTime,
          salt,
        ],
      ),
    );
    recordExecutionProof(orderId, {
      commitment: executionCommitment,
      salt,
      symbol: privateOrder.symbol,
      dstockUnits,
      filledShares,
      filledShareAtoms: filledShareAtoms.toString(),
      fillPriceUsdc: fillPriceUsdc.toString(),
      payoutOrRefundUsdc: amountToRefund.toString(),
      pythPriceUsdc: ethers.parseUnits(benchmark.price.toFixed(6), 6).toString(),
      pythPublishTime: benchmark.publishTime,
      status: "pending",
    });

    const alreadyProcessed = await retryRpc(
      () => contract.orderProcessed(orderId),
      "Read Hedera settlement state",
    );
    let transactionHash = "already-settled";
    if (!alreadyProcessed) {
      transactionHash = await handleTradeSettlement(
        orderId,
        dstockUnits,
        amountToRefund,
        executionCommitment,
      );
    }
    recordExecutionProof(orderId, { status: "settled", transactionHash });

    if (isBuy) {
      applyFilledBuy(orderId, ledgerShareAtoms, dstockUnits);
    } else {
      applyFilledSell(orderId, dstockUnits, ledgerShareAtoms);
    }

    console.log(
      `Settlement complete: ${orderId}; ${dstockUnits} units; Pyth deviation ${deviationBps.toFixed(1)} bps; tx ${transactionHash}`,
    );
  } finally {
    processing.delete(orderId);
  }
}

async function reconcilePendingOrders() {
  const pending = getPendingOrders();
  if (pending.length === 0) return;
  console.log(`Reconciling ${pending.length} private ledger order(s) with Alpaca`);

  const alpacaOrders = (await alpaca.getOrders({
    status: "all",
    until: null,
    after: null,
    limit: 500,
    direction: "desc",
    nested: false,
    symbols: null,
  })) as AlpacaOrder[];
  const byClientId = new Map(alpacaOrders.map(order => [order.client_order_id, order]));

  for (const pendingOrder of pending) {
    const order = byClientId.get(pendingOrder.orderId);
    if (!order) {
      console.warn(`No Alpaca order found for pending ${pendingOrder.orderId}`);
      continue;
    }
    if (order.status === "filled") {
      await settleFilledOrder(order);
    } else if (["canceled", "rejected", "expired"].includes(order.status)) {
      const processed = await retryRpc(
        () => contract.orderProcessed(pendingOrder.orderId),
        "Read Hedera cancellation state",
      );
      if (!processed) await handleTradeCancellation(pendingOrder.orderId);
      removeOrder(pendingOrder.orderId);
    } else {
      console.log(`Pending ${pendingOrder.orderId} remains ${order.status}`);
    }
  }
}

export async function listenToOrderEvents() {
  const ws = alpaca.trade_ws;

  ws.onConnect(async () => {
    console.log("Connected to Alpaca order streams.");
    ws.subscribe(["trade_updates"]);
    try {
      await reconcilePendingOrders();
    } catch (error) {
      console.error("Startup order reconciliation failed:", error);
    }
  });

  ws.onStateChange((state) => {
    console.log("Websocket state changed:", state);
  });

  ws.onOrderUpdate(async (event) => {
    try {
      console.log("event", event);

      const { event: status, order } = event;
      const orderId = order.client_order_id;
      console.log("got order", orderId);

      if (!hasOrder(orderId)) {
        console.log("order is not there");
        return;
      }

      if (status === "fill") {
        await settleFilledOrder(order as AlpacaOrder);
      } else if (["canceled", "rejected", "expired"].includes(status)) {
        const tx = await handleTradeCancellation(orderId);
        removeOrder(orderId);
        console.log(`Canceled on-chain request ${orderId}: ${tx}`);
      } else {
        console.log("order is pending for order with orderId:", orderId);
      }
    } catch (error) {
      console.error("Alpaca settlement rejected:", error);
    }
  });

  ws.connect();

  // Alpaca websocket events are not replayed after downtime. Periodic
  // reconciliation makes settlement restart-safe and recovers RPC/WS outages.
  const reconciliationTimer = setInterval(() => {
    reconcilePendingOrders().catch(error => {
      console.error("Periodic order reconciliation failed:", error);
    });
  }, 60_000);
  reconciliationTimer.unref();
}
