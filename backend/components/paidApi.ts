import type { Request, Response } from "express";
import { contract } from "./contract";

/** Paid order-status lookup — reads TradeLayer.requests + orderProcessed. */
export async function orderStatusHandler(req: Request, res: Response) {
  const orderId = req.params.orderId;
  if (!orderId) {
    res.status(400).json({ error: "orderId required" });
    return;
  }

  const cached = (req as Request & { x402ResourceData?: Record<string, unknown> }).x402ResourceData;
  if (!cached) {
    res.status(500).json({ error: "resource was not validated before payment" });
    return;
  }

  res.json({
    ...cached,
    settlement: (req as Request & { x402Settlement?: unknown }).x402Settlement ?? null,
  });
}

/** Paid public portfolio snapshot. Per-stock allocations are intentionally absent. */
export async function portfolioHandler(req: Request, res: Response) {
  const address = req.params.address;
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    res.status(400).json({ error: "valid EVM address required" });
    return;
  }

  const cached = (req as Request & { x402ResourceData?: Record<string, unknown> }).x402ResourceData;
  if (!cached) {
    res.status(500).json({ error: "resource was not validated before payment" });
    return;
  }

  res.json({
    ...cached,
    privacy: "Per-stock positions are not stored on-chain",
    settlement: (req as Request & { x402Settlement?: unknown }).x402Settlement ?? null,
  });
}

export async function validateOrderStatusResource(req: Request) {
  const orderId = req.params.orderId;
  if (!orderId) return "orderId required";
  const used = await contract.orderIdUsed(orderId);
  if (!used) return "order not found";
  const [reqOnChain, processed] = await Promise.all([contract.requests(orderId), contract.orderProcessed(orderId)]);
  (req as Request & { x402ResourceData?: Record<string, unknown> }).x402ResourceData = {
    orderId,
    requester: reqOnChain[0],
    usdcBalance: reqOnChain[1].toString(),
    tokenBalance: reqOnChain[2].toString(),
    isRedeem: reqOnChain[3],
    orderIdUsed: used,
    orderProcessed: processed,
  };
  return null;
}

export async function validatePortfolioResource(req: Request) {
  const address = req.params.address;
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return "valid EVM address required";
  const [dstock, locked] = await Promise.all([contract.balanceOf(address), contract.lockedForRedeem(address)]);
  (req as Request & { x402ResourceData?: Record<string, unknown> }).x402ResourceData = {
    address,
    dstockBalance: dstock.toString(),
    lockedForRedeem: locked.toString(),
  };
  return null;
}
