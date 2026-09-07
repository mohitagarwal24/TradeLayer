import type { Request, Response } from "express";
import { getAddress, verifyMessage } from "ethers";
import { getPrivatePositions } from "./orderStore";
import { atomsToShares } from "./tradeUnits";

export function portfolioAuthMessage(address: string, timestamp: string) {
  return `TradeLayer private portfolio\nAddress: ${getAddress(address)}\nTimestamp: ${timestamp}`;
}

export async function privatePortfolioHandler(req: Request, res: Response) {
  try {
    const address = req.params.address;
    const timestamp = req.header("X-PORTFOLIO-TIMESTAMP");
    const signature = req.header("X-PORTFOLIO-SIGNATURE");
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address) || !timestamp || !signature) {
      res.status(401).json({ error: "wallet signature required" });
      return;
    }

    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60_000) {
      res.status(401).json({ error: "portfolio signature expired" });
      return;
    }

    const normalized = getAddress(address);
    const recovered = verifyMessage(portfolioAuthMessage(normalized, timestamp), signature);
    if (recovered !== normalized) {
      res.status(403).json({ error: "signature does not match portfolio address" });
      return;
    }

    const positions = Object.entries(getPrivatePositions(normalized)).map(([symbol, position]) => ({
      symbol,
      shares: atomsToShares(BigInt(position.shareAtoms)),
      shareAtoms: position.shareAtoms,
      receiptUnits: position.receiptUnits,
      depositedUsdc: position.receiptUnits / 100, // $0.01 per unit
    }));
    res.json({ address: normalized, positions });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
}
