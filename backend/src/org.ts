import type { Request, Response } from "express";
import { decodeBytes32String, getAddress, isAddress } from "ethers";
import { config } from "./config";
import { escrow, ledger, registry, router, vault } from "./hedera";
import { toBytes32 } from "./eip712";
import { log } from "./log";

/**
 * Read-only status for the web app.
 *
 * Everything here is already public on-chain — membership, pool totals, ciphertext versions. No
 * endpoint reveals a balance, a position or a rule, because this process cannot read them either:
 * institution and employee balances exist only as ciphertext in ConfidentialLedger, decryptable
 * inside the enclave or by the employee's own wallet.
 */

const ZERO32 = `0x${"0".repeat(64)}`;

function orgName(b32: string): string {
  try {
    return decodeBytes32String(b32);
  } catch {
    return b32;
  }
}

/** Which screen the connected wallet should see: found an institution, wait, or trade. */
export async function walletStatusHandler(req: Request, res: Response) {
  const raw = String(req.params.address ?? "");
  if (!isAddress(raw)) {
    res.status(400).json({ error: "not an address" });
    return;
  }
  const address = getAddress(raw);
  try {
    const [orgIdRaw, pending] = await Promise.all([
      registry.orgOf(address) as Promise<string>,
      registry.pendingJoin(address) as Promise<[boolean, string]>,
    ]);
    const bound = orgIdRaw !== ZERO32;
    const orgId = bound ? orgIdRaw : pending[0] ? pending[1] : null;
    const admin = orgId ? ((await registry.adminOf(orgId)) as string) : null;

    res.json({
      address,
      member: bound,
      pending: !bound && pending[0],
      orgId,
      org: orgId ? orgName(orgId) : null,
      isAdmin: bound && admin !== null && getAddress(admin) === address,
    });
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
}

/** Institution-level facts. Deliberately no per-institution balance: there isn't one on-chain. */
export async function orgStatusHandler(req: Request, res: Response) {
  const name = String(req.params.orgId ?? "");
  if (!name) {
    res.status(400).json({ error: "orgId required" });
    return;
  }
  try {
    const orgId = toBytes32(name);
    const [admin, wallets, policy, reserve, available, openCount] = await Promise.all([
      registry.adminOf(orgId) as Promise<string>,
      registry.walletCountOf(orgId) as Promise<bigint>,
      ledger.policy(orgId) as Promise<{ blob: string; version: bigint }>,
      vault.reserve() as Promise<bigint>,
      vault.available() as Promise<bigint>,
      escrow.openCount() as Promise<bigint>,
    ]);
    if (admin === "0x0000000000000000000000000000000000000000") {
      res.status(404).json({ error: "no such institution", orgId });
      return;
    }
    res.json({
      orgId,
      org: orgName(orgId),
      admin,
      wallets: Number(wallets),
      // A version number and a byte count: the rules themselves are unreadable here.
      rulesVersion: Number(policy.version),
      // Pool totals are platform-wide by design — the omnibus is one undifferentiated reserve.
      pool: { reserve: reserve.toString(), available: available.toString() },
      openOrders: Number(openCount),
    });
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
}

/** Per-equity compliance status for one wallet, for the admin's People screen. */
export async function complianceStatusHandler(req: Request, res: Response) {
  const raw = String(req.params.address ?? "");
  if (!isAddress(raw)) {
    res.status(400).json({ error: "not an address" });
    return;
  }
  try {
    const out: Record<string, { kyc: boolean; listed: boolean; frozen: boolean }> = {};
    for (const symbol of config.symbols) {
      const [kyc, listed, frozen] = (await router.statusOf(toBytes32(symbol), raw)) as [boolean, boolean, boolean];
      out[symbol] = { kyc, listed, frozen };
    }
    res.json({ address: getAddress(raw), admitted: out });
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
}

/** The tickers the platform can actually settle, with live prices where available. */
export async function marketHandler(_req: Request, res: Response) {
  const { baseUrl, keyId, secret } = config.marketData;
  const symbols = config.symbols;
  if (!keyId || !secret) {
    res.json({ symbols, prices: {}, note: "no market-data credentials configured" });
    return;
  }
  try {
    const url = `${baseUrl}/v2/stocks/trades/latest?symbols=${encodeURIComponent(symbols.join(","))}`;
    const r = await fetch(url, { headers: { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secret } });
    if (!r.ok) {
      res.json({ symbols, prices: {}, note: `market data ${r.status}` });
      return;
    }
    const body = (await r.json()) as { trades?: Record<string, { p: number; t: string }> };
    const prices: Record<string, { price: number; at: string }> = {};
    for (const [symbol, trade] of Object.entries(body.trades ?? {})) prices[symbol] = { price: trade.p, at: trade.t };
    res.json({ symbols, prices });
  } catch (error) {
    log("warn", "market data unavailable", { reason: (error as Error).message.slice(0, 80) });
    res.json({ symbols, prices: {}, note: "market data unavailable" });
  }
}

/** Whether the US market is open — so the UI can say "queued until Monday" instead of failing. */
export async function marketClockHandler(_req: Request, res: Response) {
  const { keyId, secret } = config.marketData;
  if (!keyId || !secret) {
    res.json({ isOpen: null });
    return;
  }
  try {
    const r = await fetch("https://paper-api.alpaca.markets/v2/clock", {
      headers: { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secret },
    });
    if (!r.ok) {
      res.json({ isOpen: null });
      return;
    }
    res.json(await r.json());
  } catch {
    res.json({ isOpen: null });
  }
}
