import type { CronPayload, HTTPPayload, TeeRuntime } from "@chainlink/cre-sdk";
import type { Config } from "./config";
import {
  accountIdOf,
  accountKey,
  bytes32,
  envelopeCommit,
  ONE_SHARE,
  sharesToUnits,
  fromHex,
  intentDigest,
  openEnvelope,
  orgKey,
  policyIntentDigest,
  recoverAddress,
  toHex,
  type Envelope,
  type Hex,
  type Intent,
  type PolicySubmission,
} from "./crypto";
import { getOrderByClientId, getPositions, placeMarketBuy, type BrokerCreds } from "./broker";
import {
  OrderStatus,
  readAtsSupply,
  readAtsVaultBalance,
  readEntry,
  readOpenOrders,
  readOrder,
  readOrgAdmin,
  readPolicy,
} from "./hedera";
import { decodePolicy, decodePortfolio, emptyPortfolio, encodePolicy, encodePortfolio, type Policy, type Portfolio } from "./ledger";
import {
  authorizeAtsDelta,
  authorizeCancel,
  authorizeLedgerUpdate,
  authorizePolicyUpdate,
  authorizeSettlement,
  relay,
} from "./relay";

/**
 * The four confidential handlers. Everything that reads plaintext — intents, portfolios, company
 * rules, broker credentials — happens here, inside `handlerInTee`. What crosses back out is a
 * status, an order id, or a signed authorization the relayer cannot alter.
 *
 * These handlers **do** narrate the order in the clear — the symbol, the amount, the rule that let
 * it through. That is deliberate and is not a leak: `runtime.log` output belongs to the enclave,
 * and CRE does not surface it outside the TEE in a deployed run ("user logs for this trigger will
 * not be visible, and will not leave the TEE"). Under `cre workflow simulate` it prints locally,
 * on a machine that already holds the keys in `cre/.env`.
 *
 * The invariant that matters is the one a step down: **nothing readable ever reaches the backend,
 * the relayer or the chain.** Those see ciphertext, signatures and an amount. See `backend/src/log.ts`.
 */

/** USDC. The settlement leg is Circle's token, used as-is — we wrap nothing. */
const USDC_DECIMALS = 6n;
const ONE_USDC = 10n ** USDC_DECIMALS;

/** USDC base units -> a plain dollar string, for enclave narration only. */
function dollars(baseUnits: bigint): string {
  return `${baseUnits / ONE_USDC}.${(baseUnits % ONE_USDC).toString().padStart(6, "0").slice(0, 2)}`;
}

type Secrets = {
  intentKey: Uint8Array;
  masterKey: Uint8Array;
  signingKey: Uint8Array;
  broker: BrokerCreds;
  relayToken: string;
};

function loadSecrets(runtime: TeeRuntime<Config>): Secrets {
  const get = (id: string) => runtime.getSecret({ id }).result().value;
  return {
    intentKey: fromHex(get("INTENT_PRIVKEY")),
    masterKey: fromHex(get("LEDGER_MASTER_KEY")),
    signingKey: fromHex(get("ENCLAVE_SIGNING_KEY")),
    broker: { keyId: get("ALPACA_KEY_ID"), secret: get("ALPACA_SECRET_KEY") },
    relayToken: get("RELAY_AUTH_TOKEN"),
  };
}

function signer(runtime: TeeRuntime<Config>, s: Secrets) {
  return { key: s.signingKey, chainId: BigInt(runtime.config.hedera.chainId), contracts: runtime.config.hedera };
}

/**
 * What a fill cost, in USDC base units: average price × filled shares, rounded up to the cent so
 * the escrow is never short. `filledUnits` is 9dp, the price is a decimal dollar string.
 */
function costOfFill(priceUsd: string, filledUnits: bigint): bigint {
  const [whole, frac = ""] = priceUsd.split(".");
  const priceMicro = BigInt(whole) * ONE_USDC + BigInt((frac + "000000").slice(0, 6));
  const raw = (priceMicro * filledUnits) / ONE_SHARE;
  const cent = 10n ** 4n;
  return ((raw + cent - 1n) / cent) * cent;
}

/* ====================================================================================== */
/* H1 — intake                                                                             */
/* ====================================================================================== */

type IntakePayload = { orderId: Hex; envelope: Envelope };

export type IntakeResult = {
  orderId: Hex;
  status: "PLACED" | "REJECTED" | "IGNORED";
  reason?: string;
  relay?: string;
  txHash?: string;
};

export type ReconcileResult = { checked: number; summary: Array<{ orderId: string; action: string; relay?: string }> };

export type BatchResult = {
  reserveOk?: boolean;
  note?: string;
  deltas?: Array<{ symbol: string; delta: string; relay?: string; note?: string }>;
};

/** What trigger 0 returns, whichever handler ran. One concrete type rather than a union: the
 * SDK binds a single output type per handler. `handler` says which branch answered. */
export type HttpResult = {
  handler: "H1" | "H4";
  status: "PLACED" | "REJECTED" | "IGNORED" | "APPLIED";
  orderId?: Hex;
  orgId?: string;
  reason?: string;
  relay?: string;
  txHash?: string;
  version?: string;
};

/**
 * The single HTTP entry point.
 *
 * A deployed workflow may register only **one** HTTP trigger: "There is currently no mechanism to
 * route requests to different HTTP trigger handlers within the same workflow." So the two
 * HTTP-driven handlers share one trigger and branch on the payload, which is the documented
 * pattern. Simulation would happily run two, which is exactly why this was not caught earlier.
 *
 * `kind` is explicit. Where it is absent the shape decides, but only when it is unambiguous — a
 * body carrying both `orderId` and `orgId` is refused rather than guessed at, because silently
 * resolving an order as a policy (or the reverse) would send it to the wrong signing path.
 */
export function onHttp(runtime: TeeRuntime<Config>, payload: HTTPPayload): HttpResult {
  const body = JSON.parse(new TextDecoder().decode(payload.input)) as {
    kind?: string;
    orderId?: string;
    orgId?: string;
  };

  if (body.kind === "order") return { handler: "H1", ...onIntake(runtime, payload) };
  if (body.kind === "policy") return { handler: "H4", ...onPolicy(runtime, payload) };
  if (body.kind !== undefined) throw new Error(`unknown http payload kind: ${body.kind}`);

  const hasOrder = typeof body.orderId === "string";
  const hasOrg = typeof body.orgId === "string";
  if (hasOrder && !hasOrg) return { handler: "H1", ...onIntake(runtime, payload) };
  if (hasOrg && !hasOrder) return { handler: "H4", ...onPolicy(runtime, payload) };
  throw new Error("http payload must carry kind: 'order' | 'policy'");
}

export function onIntake(runtime: TeeRuntime<Config>, payload: HTTPPayload): IntakeResult {
  const cfg = runtime.config;
  const body = JSON.parse(new TextDecoder().decode(payload.input)) as IntakePayload;
  const orderId = body.orderId;
  const short = orderId.slice(0, 10);
  runtime.log(`H1 ${short}: envelope received`);

  const secrets = loadSecrets(runtime);
  const s = signer(runtime, secrets);

  const reject = (reason: string): IntakeResult => {
    runtime.log(`H1 ${short}: rejected (${reason})`);
    const result = relay(runtime, cfg.relayerUrl, authorizeCancel(s, orderId), secrets.relayToken);
    return { orderId, status: "REJECTED", reason, relay: result.status };
  };

  // 1. The escrow must exist, be OPEN, and be anchored to exactly this envelope.
  const order = readOrder(runtime, cfg.hedera, orderId);
  if (order.status !== OrderStatus.OPEN) return { orderId, status: "IGNORED", reason: `escrow status ${order.status}` };
  if (order.commit.toLowerCase() !== envelopeCommit(body.envelope).toLowerCase()) return reject("commit mismatch");

  // 2. Open the envelope and verify the employee's signature over the intent.
  let intent: Intent;
  try {
    intent = JSON.parse(new TextDecoder().decode(openEnvelope(body.envelope, secrets.intentKey))) as Intent;
  } catch {
    return reject("cannot open envelope");
  }
  if (intent.v !== 1 || intent.orderId.toLowerCase() !== orderId.toLowerCase()) return reject("intent/order mismatch");
  // The one place the order exists in the clear. Narrated so a demo can show the same bytes being
  // opaque to the intake API a second earlier and readable here — which is the whole architecture
  // in two lines. In a deployed run CRE does not surface these outside the enclave.
  runtime.log(
    `H1 ${short}: envelope opened — {"symbol":"${intent.symbol}","side":"${intent.side}",` +
      `"maxSpend":"$${dollars(BigInt(intent.maxSpend))}","nonce":${intent.nonce}}`,
  );
  const recovered = recoverAddress(intentDigest(intent, BigInt(cfg.hedera.chainId), cfg.hedera.escrow), intent.sig);
  if (recovered.toLowerCase() !== order.requester.toLowerCase()) return reject("intent not signed by requester");
  runtime.log(`H1 ${short}: intent signature recovers to ${recovered.slice(0, 12)}… = escrow.requester ✓`);
  if (intent.account.toLowerCase() !== order.requester.toLowerCase()) return reject("account mismatch");
  // The institution is whatever OrgWalletRegistry said when the escrow opened — the contract
  // resolved and stored it there. `intent.orgId` is user-supplied and unauthenticated, so it is
  // only ever compared, never trusted: a mismatch means someone is trying to have their order
  // judged against another institution's private rules.
  const orgId = order.orgId;
  if (toHex(bytes32(intent.orgId)).toLowerCase() !== orgId.toLowerCase()) return reject("org mismatch");
  runtime.log(`H1 ${short}: institution taken from OrgWalletRegistry via the escrow — intent.orgId only compared, never trusted`);
  if (intent.side !== "BUY") return reject("only BUY supported");
  if (!cfg.hedera.symbols[intent.symbol]) return reject("unsupported symbol");
  // Alpaca rejects a notional buy under $1.
  if (BigInt(intent.maxSpend) < ONE_USDC) return reject("below the broker's $1 minimum");

  const now = BigInt(Math.floor(runtime.now().getTime() / 1000));
  if (order.expiry < now + BigInt(cfg.policy.minExpiryWindowSeconds)) return reject("expiry too soon");
  if (order.amount < BigInt(intent.maxSpend)) return reject("escrow below maxSpend");

  // 3. Private state: the employee's portfolio and the organization's rules.
  const accountId = accountIdOf(order.requester);
  const aKey = accountKey(secrets.masterKey, accountId);
  const entry = readEntry(runtime, cfg.hedera, toHex(accountId));
  const portfolio = decodePortfolio(aKey, entry.enclaveBlob) ?? emptyPortfolio(intent.userPubKey);
  if (intent.nonce <= portfolio.nonce) return reject("stale nonce");
  if (portfolio.openOrders[orderId]) return { orderId, status: "PLACED", reason: "already recorded" };

  const policyBlob = readPolicy(runtime, cfg.hedera, orgId).blob;
  let policy: Policy | null;
  try {
    policy = decodePolicy(orgKey(secrets.masterKey, fromHex(orgId)), policyBlob);
  } catch {
    // A policy exists but this enclave cannot read it (wrong master key, corrupt blob). Rules we
    // cannot evaluate must not be treated as rules that passed — fail closed.
    return reject("policy unreadable");
  }
  if (policy) {
    runtime.log(`H1 ${short}: rulebook decrypted — ${(policyBlob.length - 2) / 2}B of ciphertext, unreadable outside this enclave`);
    const rule = policy.employees[order.requester.toLowerCase()];
    if (!rule || !rule.canBuy) return reject("policy: not permitted to buy");
    if (rule.restricted.includes(intent.symbol)) return reject("policy: restricted symbol");
    if (BigInt(intent.maxSpend) > BigInt(policy.maxOrderNotional)) return reject("policy: above max notional");
    runtime.log(
      `H1 ${short}: pre-trade check PASSED — permitted to buy ✓ · ${intent.symbol} not restricted ✓ · ` +
        `$${dollars(BigInt(intent.maxSpend))} ≤ $${dollars(BigInt(policy.maxOrderNotional))} limit ✓`,
    );
  } else {
    runtime.log(`H1 ${short}: no policy set for org — default allow`);
  }

  // 4. Exactly one broker order, by amount. Idempotent at the broker by client_order_id.
  const placed = placeMarketBuy(runtime, cfg.broker, secrets.broker, intent.symbol, BigInt(intent.maxSpend), orderId);
  if (placed.status === "rejected") return reject("broker rejected");

  // 5. Record the open order in the encrypted portfolio and sign the ledger write.
  const next: Portfolio = {
    ...portfolio,
    userPubKey: intent.userPubKey,
    nonce: intent.nonce,
    openOrders: {
      ...portfolio.openOrders,
      [orderId]: {
        side: "BUY",
        symbol: intent.symbol,
        notional: intent.maxSpend,
        escrow: order.amount.toString(),
        brokerOrderId: placed.id,
        placedAt: Number(now),
      },
    },
  };
  const blobs = encodePortfolio(aKey, next, entry.version + 1n, fromHex(orderId));
  const auth = authorizeLedgerUpdate(s, accountId, blobs.enclaveBlob, blobs.userBlob, entry.version);
  const result = relay(runtime, cfg.relayerUrl, auth, secrets.relayToken);
  runtime.log(`H1 ${short}: placed; ledger v${entry.version + 1n} relay ${result.status}`);

  return { orderId, status: "PLACED", relay: result.status, txHash: result.txHash };
}

/* ====================================================================================== */
/* H2 — reconcile fills                                                                    */
/* ====================================================================================== */

export function onReconcile(runtime: TeeRuntime<Config>, _payload: CronPayload): ReconcileResult {
  const cfg = runtime.config;
  const secrets = loadSecrets(runtime);
  const s = signer(runtime, secrets);
  const ids = readOpenOrders(runtime, cfg.hedera, 0n, BigInt(cfg.policy.maxOpenOrdersPerTick));
  runtime.log(`H2: ${ids.length} open order(s)`);

  const summary: Array<{ orderId: string; action: string; relay?: string }> = [];
  for (const orderId of ids) {
    const short = orderId.slice(0, 10);
    try {
      const order = readOrder(runtime, cfg.hedera, orderId);
      if (order.status !== OrderStatus.OPEN) continue;
      const accountId = accountIdOf(order.requester);
      const aKey = accountKey(secrets.masterKey, accountId);
      const entry = readEntry(runtime, cfg.hedera, toHex(accountId));
      const portfolio = decodePortfolio(aKey, entry.enclaveBlob);
      const open = portfolio?.openOrders[orderId];
      if (!portfolio || !open) {
        summary.push({ orderId: short, action: "not-in-ledger" });
        continue;
      }

      const broker = getOrderByClientId(runtime, cfg.broker, secrets.broker, orderId);
      if (["canceled", "expired", "rejected"].includes(broker.status)) {
        const result = relay(runtime, cfg.relayerUrl, authorizeCancel(s, orderId), secrets.relayToken);
        summary.push({ orderId: short, action: "cancel", relay: result.status });
        continue;
      }
      if (broker.status !== "filled" || !broker.filledAvgPrice) {
        // Outside market hours Alpaca holds the order as accepted/new until the next session.
        // That is a real, expected state — not a failure — so leave the escrow open and retry.
        summary.push({ orderId: short, action: `pending:${broker.status}` });
        continue;
      }

      // Fill → atomic settlement: shares credited ⇔ escrow released. Both sides are fractional
      // now, so `spent` is what the broker actually charged rather than a price × whole-share
      // estimate — which also removes the old "gapped fill, vault absorbs the overage" case.
      const filledUnits = sharesToUnits(broker.filledQty);
      if (filledUnits === 0n) {
        summary.push({ orderId: short, action: "filled-zero" });
        continue;
      }
      let spent = costOfFill(broker.filledAvgPrice, filledUnits);
      if (spent > order.amount) spent = order.amount;

      const pos = portfolio.positions[open.symbol] ?? { qty: "0", locked: "0" };
      const nextOpen = { ...portfolio.openOrders };
      delete nextOpen[orderId];
      const next: Portfolio = {
        ...portfolio,
        positions: { ...portfolio.positions, [open.symbol]: { ...pos, qty: (BigInt(pos.qty) + filledUnits).toString() } },
        openOrders: nextOpen,
      };
      const blobs = encodePortfolio(aKey, next, entry.version + 1n, fromHex(orderId));
      // The settlement is the one moment shares and cash move together; narrate it, or the only
      // sign it happened is a chain event several seconds later.
      runtime.log(
        `H2 ${short}: filled ${broker.filledQty} ${open.symbol} @ $${broker.filledAvgPrice} — ` +
          `settling $${dollars(spent)} atomically: shares credited ⇔ escrow released`,
      );
      const result = relay(runtime, cfg.relayerUrl, authorizeSettlement(s, orderId, spent, blobs.enclaveBlob, blobs.userBlob, entry.version), secrets.relayToken);
      runtime.log(`H2 ${short}: settlement ${result.status}; encrypted position now v${entry.version + 1n}`);
      summary.push({ orderId: short, action: "settle", relay: result.status });
      // Supply is deliberately NOT moved here. Minting per fill would let an observer line up a
      // supply change with one escrow release; H3 nets every fill across every institution
      // instead, so individual trades disappear into the aggregate.
    } catch (error) {
      summary.push({ orderId: short, action: `error:${(error as Error).message.slice(0, 80)}` });
    }
  }
  return { checked: ids.length, summary };
}

/* ====================================================================================== */
/* H3 — batch: keep ATS supply equal to broker positions                                   */
/* ====================================================================================== */

export function onBatch(runtime: TeeRuntime<Config>, _payload: CronPayload): BatchResult {
  const cfg = runtime.config;
  const secrets = loadSecrets(runtime);
  const s = signer(runtime, secrets);
  const positions = getPositions(runtime, cfg.broker, secrets.broker);

  const deltas: Array<{ symbol: string; delta: string; relay?: string; note?: string }> = [];
  // `reserveOk` reports the state this batch *leaves behind*: every symbol's on-chain supply
  // equals the broker's position. Drift that the batch corrects is normal operation, not a
  // shortfall — only an adjustment that fails to land leaves the reserve unbacked.
  let reserveOk = true;
  for (const symbol of Object.keys(cfg.hedera.symbols)) {
    const supply = readAtsSupply(runtime, cfg.hedera, symbol);
    const held = positions[symbol] ?? 0n;
    if (held === supply) continue;

    if (held > supply) {
      const amount = held - supply;
      const result = relay(runtime, cfg.relayerUrl, authorizeAtsDelta(s, "atsMint", symbol, amount, supply), secrets.relayToken);
      if (result.status !== "confirmed") reserveOk = false;
      deltas.push({ symbol, delta: `+${amount}`, relay: result.status });
      continue;
    }

    // Over-supplied. The vault can only burn what it actually holds; anything beyond that sits in
    // employees' wallets as withdrawn shares and cannot be clawed back here. Burn what we can and
    // report the remainder as a genuine backing shortfall rather than reverting the whole batch.
    const excess = supply - held;
    const inVault = readAtsVaultBalance(runtime, cfg.hedera, symbol);
    const burnable = excess < inVault ? excess : inVault;
    if (burnable > 0n) {
      const result = relay(runtime, cfg.relayerUrl, authorizeAtsDelta(s, "atsBurn", symbol, burnable, supply), secrets.relayToken);
      if (result.status !== "confirmed") reserveOk = false;
      deltas.push({ symbol, delta: `-${burnable}`, relay: result.status });
    }
    if (excess > burnable) {
      reserveOk = false;
      deltas.push({ symbol, delta: `-${excess - burnable}`, note: "unbacked: held outside the vault" });
    }
  }
  runtime.log(`H3: ${deltas.length} adjustment(s); reserveOk=${reserveOk}`);
  return { reserveOk, deltas };
}

/* ====================================================================================== */
/* H4 — policy: the org admin's private rulebook                                           */
/* ====================================================================================== */

export type PolicyResult = {
  orgId: string;
  status: "APPLIED" | "REJECTED";
  reason?: string;
  version?: string;
  relay?: string;
  txHash?: string;
};

type PolicyPayload = { orgId: string; envelope: Envelope };

/** Structural check before anything is encrypted — a malformed rulebook must not reach storage,
 * because H1 fails closed on a policy it cannot evaluate and would block every order. */
function validPolicy(p: unknown): p is Policy {
  const o = p as Policy;
  if (!o || typeof o !== "object" || o.v !== 1) return false;
  if (typeof o.maxOrderNotional !== "string" || !/^\d+$/.test(o.maxOrderNotional)) return false;
  if (typeof o.allowWithdrawShares !== "boolean") return false;
  if (!o.employees || typeof o.employees !== "object") return false;
  for (const [addr, rule] of Object.entries(o.employees)) {
    if (!/^0x[0-9a-f]{40}$/.test(addr)) return false; // lowercased, as H1 looks them up
    if (typeof rule?.canBuy !== "boolean" || typeof rule?.canSell !== "boolean") return false;
    if (typeof rule?.dailyCap !== "string" || !/^\d+$/.test(rule.dailyCap)) return false;
    if (!Array.isArray(rule?.restricted) || rule.restricted.some(s => typeof s !== "string")) return false;
  }
  return true;
}

/**
 * The company's rules arrive sealed, exactly like an order: the admin signs them EIP-712 and
 * encrypts them to the enclave, so the intake API and the relayer carry a rulebook they cannot
 * read. Inside, the enclave proves authorship against `vault.orgAdmin(orgId)` on chain, then
 * re-encrypts under the org key and signs the write. Nothing here logs a rule.
 */
export function onPolicy(runtime: TeeRuntime<Config>, payload: HTTPPayload): PolicyResult {
  const cfg = runtime.config;
  const body = JSON.parse(new TextDecoder().decode(payload.input)) as PolicyPayload;
  const orgId = body.orgId;
  runtime.log(`H4 ${orgId}: sealed policy received`);

  const secrets = loadSecrets(runtime);
  const s = signer(runtime, secrets);
  const reject = (reason: string): PolicyResult => {
    runtime.log(`H4 ${orgId}: rejected (${reason})`);
    return { orgId, status: "REJECTED", reason };
  };

  // 1. Open the envelope.
  let submission: PolicySubmission;
  try {
    submission = JSON.parse(new TextDecoder().decode(openEnvelope(body.envelope, secrets.intentKey))) as PolicySubmission;
  } catch {
    return reject("cannot open envelope");
  }
  if (submission.v !== 1 || submission.orgId !== orgId) return reject("orgId mismatch");

  // 2. Authorship: the signature must recover to the org admin the vault names on chain.
  const admin = readOrgAdmin(runtime, cfg.hedera, orgId);
  if (/^0x0{40}$/i.test(admin)) return reject("unknown org");
  const recovered = recoverAddress(
    policyIntentDigest(submission, BigInt(cfg.hedera.chainId), cfg.hedera.vault),
    submission.sig,
  );
  if (recovered.toLowerCase() !== admin.toLowerCase()) return reject("not signed by the org admin");
  if (submission.admin.toLowerCase() !== admin.toLowerCase()) return reject("admin mismatch");
  // No separate hash check is needed: `policyIntentDigest` hashes `submission.policy` itself, so
  // the signature above already binds these exact rule bytes.

  // 3. Shape, then freshness. `expectedVersion` is the on-chain replay guard; `nonce` keeps two
  //    submissions for the same version from being interchangeable.
  if (!validPolicy(submission.policy)) return reject("malformed policy");
  const current = readPolicy(runtime, cfg.hedera, orgId);
  if (BigInt(submission.nonce) <= current.version) return reject("stale policy nonce");

  // 4. Re-encrypt under the org key and sign the write.
  const blob = encodePolicy(orgKey(secrets.masterKey, bytes32(orgId)), submission.policy, current.version + 1n);
  const result = relay(runtime, cfg.relayerUrl, authorizePolicyUpdate(s, orgId, blob, current.version), secrets.relayToken);
  runtime.log(`H4 ${orgId}: policy v${current.version + 1n} relay ${result.status}`);

  return {
    orgId,
    status: "APPLIED",
    version: (current.version + 1n).toString(),
    relay: result.status,
    txHash: result.txHash,
  };
}
