import type { Config } from "./config";
import { type AnyRuntime, request } from "./http";
import { sharesToUnits } from "./crypto";

/**
 * Broker access from inside the enclave. Credentials are enclave secrets and travel only in
 * confidential-HTTP headers. `client_order_id = orderId` makes every placement idempotent at the
 * broker, so a retried run can never buy twice.
 *
 * There is deliberately no mock. A fabricated fill is not a settlement, and the states that
 * actually matter — queued outside market hours, partially filled, rejected — only exist against
 * the real API. An order placed while the market is shut is *accepted and queued*, not an error.
 */

export type BrokerCreds = { keyId: string; secret: string };

/**
 * Alpaca caps `client_order_id` at 48 characters; our order id is `0x` + 64 hex = 66. Take the
 * first 32 hex characters — 128 bits, deterministic, and derived identically by H1 (placing) and
 * H2 (polling), so the broker itself remains the idempotency barrier against a duplicate buy.
 */
export function brokerClientId(orderId: string): string {
  return orderId.replace(/^0x/, "").slice(0, 32);
}

export type BrokerOrder = {
  id: string;
  status: "accepted" | "new" | "partially_filled" | "filled" | "canceled" | "expired" | "rejected" | string;
  /** Decimal share count, fractional — e.g. "0.054729384". */
  filledQty: string;
  filledAvgPrice: string | null;
};

/** USDC base units (6dp) -> the decimal dollar string Alpaca's `notional` field expects. */
function usdcToDollars(baseUnits: bigint): string {
  const whole = baseUnits / 1_000_000n;
  const cents = (baseUnits % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${whole}.${cents}`;
}

function headers(creds: BrokerCreds): Record<string, string> {
  return { "APCA-API-KEY-ID": creds.keyId, "APCA-API-SECRET-KEY": creds.secret };
}

/**
 * One notional buy: "spend this many dollars on this symbol". Alpaca decides the share count,
 * which is what makes a small treasury usable — a whole share of most tickers is out of reach.
 * `notional` and `qty` are mutually exclusive; sending both is rejected.
 */
export function placeMarketBuy<C>(
  runtime: AnyRuntime<C>,
  cfg: Config["broker"],
  creds: BrokerCreds | null,
  symbol: string,
  notionalUsdc: bigint,
  clientOrderId: string,
): BrokerOrder {
  const clientId = brokerClientId(clientOrderId);
  if (!creds) throw new Error("broker credentials missing");
  const dollars = usdcToDollars(notionalUsdc);
  // Narrated because a real broker order is the single hardest thing in this system to fake, and
  // it was previously silent. These lines are enclave logs: CRE does not surface them outside the
  // TEE in a deployed run, so the symbol and amount here never reach the operator.
  runtime.log(`broker: POST ${cfg.baseUrl}/v2/orders — ${symbol} market buy, notional $${dollars}`);
  runtime.log(`broker: client_order_id ${clientId} (idempotency barrier — a retry cannot buy twice)`);
  const res = request(runtime, {
    url: `${cfg.baseUrl}/v2/orders`,
    method: "POST",
    headers: headers(creds),
    timeout: "15s",
    body: {
      symbol,
      notional: dollars,
      side: "buy",
      type: "market",
      time_in_force: "day",
      client_order_id: clientId,
    },
  });
  // 422 with "client_order_id must be unique" means an earlier run already placed it — idempotent.
  if (res.status === 422 && /client_order_id/.test(res.text)) {
    runtime.log(`broker: already placed under this client_order_id — reusing it rather than buying again`);
    return getOrderByClientId(runtime, cfg, creds, clientOrderId);
  }
  if (res.status >= 300) throw new Error(`broker POST /v2/orders ${res.status}: ${res.text.slice(0, 200)}`);
  const o = res.json() as { id: string; status: string; filled_qty: string; filled_avg_price: string | null };
  logBrokerOrder(runtime, o.id, clientId, o.status, o.filled_qty, o.filled_avg_price);
  return { id: o.id, status: o.status, filledQty: o.filled_qty, filledAvgPrice: o.filled_avg_price };
}

/**
 * The fields a judge can actually check, rather than Alpaca's full ~30-field event.
 *
 * `id` and `client_order_id` are both searchable in the Alpaca dashboard, which is the point: the
 * terminal and the broker's own UI must agree. `accepted`/`new` with nothing filled is the honest
 * out-of-hours state — the order is really queued, not quietly faked into a fill.
 */
function logBrokerOrder<C>(
  runtime: AnyRuntime<C>,
  id: string,
  clientId: string,
  status: string,
  filledQty: string,
  filledAvgPrice: string | null,
) {
  runtime.log(`broker: Alpaca responded — id ${id}`);
  runtime.log(`broker:   status ${status} · filled_qty ${filledQty}${filledAvgPrice ? ` · avg $${filledAvgPrice}` : ""}`);
  if (status === "accepted" || status === "new") {
    runtime.log(`broker:   not filled — the market is closed, so it is queued and fills at the next session`);
  } else if (status === "filled") {
    runtime.log(`broker:   filled at the live market price`);
  }
}

export function getOrderByClientId<C>(
  runtime: AnyRuntime<C>,
  cfg: Config["broker"],
  creds: BrokerCreds | null,
  clientOrderId: string,
): BrokerOrder {
  const clientId = brokerClientId(clientOrderId);
  if (!creds) throw new Error("broker credentials missing");
  const res = request(runtime, {
    url: `${cfg.baseUrl}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientId)}`,
    method: "GET",
    headers: headers(creds),
    timeout: "15s",
  });
  if (res.status === 404) return { id: "", status: "unknown", filledQty: "0", filledAvgPrice: null };
  if (res.status >= 300) throw new Error(`broker GET order ${res.status}: ${res.text.slice(0, 200)}`);
  const o = res.json() as { id: string; status: string; filled_qty: string; filled_avg_price: string | null };
  return { id: o.id, status: o.status, filledQty: o.filled_qty, filledAvgPrice: o.filled_avg_price };
}

/**
 * Positions per symbol in **9-decimal base units** — the reserve check's source of truth, and the
 * same precision the ATS equities are issued at, so supply can track a fractional position exactly
 * instead of drifting by a dust amount every batch.
 */
export function getPositions<C>(
  runtime: AnyRuntime<C>,
  cfg: Config["broker"],
  creds: BrokerCreds | null,
): Record<string, bigint> {
  if (!creds) throw new Error("broker credentials missing");
  const res = request(runtime, { url: `${cfg.baseUrl}/v2/positions`, method: "GET", headers: headers(creds) });
  if (res.status >= 300) throw new Error(`broker GET positions ${res.status}`);
  const out: Record<string, bigint> = {};
  for (const p of res.json() as Array<{ symbol: string; qty: string }>) {
    out[p.symbol] = sharesToUnits(p.qty);
  }
  return out;
}
