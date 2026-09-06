import type { Request, Response } from "express";
import { contract } from "./contract";

/** Paid order-status lookup — reads TradeLayer.requests + orderProcessed. */
export async function orderStatusHandler(req: Request, res: Response) {
  const orderId = req.params.orderId;
  if (!orderId) {
    res.status(400).json({ error: "orderId required" });
    return;
  }

  const reqOnChain = await contract.requests(orderId);
  const processed = await contract.orderProcessed(orderId);
  const used = await contract.orderIdUsed(orderId);

  res.json({
    orderId,
    requester: reqOnChain[0],
    usdcBalance: reqOnChain[1].toString(),
    tokenBalance: reqOnChain[2].toString(),
    isRedeem: reqOnChain[3],
    orderIdUsed: used,
    orderProcessed: processed,
    settlement: (req as Request & { x402Settlement?: unknown }).x402Settlement ?? null,
  });
}

/** Paid portfolio snapshot for an address. */
export async function portfolioHandler(req: Request, res: Response) {
  const address = req.params.address;
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    res.status(400).json({ error: "valid EVM address required" });
    return;
  }

  const holdings: string[] = await contract.getStockHoldings(address);
  const dstock = await contract.balanceOf(address);
  const locked = await contract.lockedForRedeem(address);

  const positions = [];
  for (const symbol of holdings) {
    const qty = await contract.totalHoldings(address, symbol);
    positions.push({ symbol, quantity: qty.toString() });
  }

  res.json({
    address,
    dstockBalance: dstock.toString(),
    lockedForRedeem: locked.toString(),
    positions,
    settlement: (req as Request & { x402Settlement?: unknown }).x402Settlement ?? null,
  });
}
