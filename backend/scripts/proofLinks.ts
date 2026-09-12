import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config";
import { escrow } from "../src/hedera";

/**
 * Every externally-checkable artefact for the most recent order, as links.
 *
 * A demo lives or dies on whether a judge can verify a claim themselves, and the worst moment to
 * be assembling HashScan URLs by hand is while recording. Run this after placing an order and open
 * the tabs it prints.
 *
 *   npx tsx scripts/proofLinks.ts            # latest order
 *   npx tsx scripts/proofLinks.ts 0x9fae…    # a specific one
 */

const HASHSCAN = "https://hashscan.io/testnet";
const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";

/** Hedera renders an EVM contract address as a 0.0.x entity; the explorer accepts either. */
async function entityOf(address: string): Promise<string | null> {
  try {
    const r = await fetch(`${MIRROR}/contracts/${address}`);
    if (!r.ok) return null;
    return ((await r.json()) as { contract_id?: string }).contract_id ?? null;
  } catch {
    return null;
  }
}

function latestOrderId(): string | undefined {
  const dir = path.join(config.dataDir, "envelopes");
  if (!fs.existsSync(dir)) return undefined;
  const files = fs
    .readdirSync(dir)
    .filter(f => f.endsWith(".json") && !f.endsWith(".payload.json"))
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files[0] ? (JSON.parse(fs.readFileSync(path.join(dir, files[0].f), "utf8")) as { orderId: string }).orderId : undefined;
}

async function main() {
  const orderId = process.argv[2] ?? latestOrderId();
  if (!orderId) throw new Error("no orders found — place one first");

  const o = await escrow.order(orderId);
  const status = ["NONE", "OPEN", "SETTLED", "CANCELLED", "REFUNDED"][Number(o.status)];
  // Alpaca caps client_order_id at 48 chars, so H1 sends the first 32 hex of the order id. That
  // is what lets a judge carry an identifier straight from the chain to the broker.
  const clientOrderId = orderId.replace(/^0x/, "").slice(0, 32);

  console.log(`\n\x1b[1mOrder\x1b[0m ${orderId}`);
  console.log(`  status ${status} · ${Number(o.amount) / 1e6} USDC reserved · deadline ${new Date(Number(o.expiry) * 1000).toLocaleString()}\n`);

  console.log("\x1b[1m1. The order on Hedera\x1b[0m");
  const res = await fetch(`${MIRROR}/contracts/${config.contracts.escrow}/results?limit=8&order=desc`)
    .then(r => r.json() as Promise<{ results?: Array<{ hash: string; timestamp: string }> }>)
    .catch(() => ({ results: [] }));
  for (const r of (res.results ?? []).slice(0, 3)) {
    console.log(`   ${HASHSCAN}/transaction/${r.hash}`);
  }

  console.log("\n\x1b[1m2. The self-refund, scheduled on-chain (HIP-1215)\x1b[0m");
  if (o.schedule && o.schedule !== "0x0000000000000000000000000000000000000000") {
    const entity = `0.0.${parseInt(o.schedule.slice(-8), 16)}`;
    console.log(`   ${HASHSCAN}/schedule/${entity}`);
    console.log(`   → "wait for expiry", not yet executed: the contract refunds itself, no keeper`);
  } else {
    console.log("   (none attached to this order)");
  }

  console.log("\n\x1b[1m3. The same order at the broker\x1b[0m");
  console.log(`   https://app.alpaca.markets/paper/dashboard/order/  → search ${clientOrderId}`);
  console.log(`   → client_order_id is the first 32 hex of the on-chain order id. Same order, both places.`);

  console.log("\n\x1b[1m4. The contracts\x1b[0m");
  for (const [name, address] of Object.entries(config.contracts)) {
    const entity = await entityOf(address as string);
    console.log(`   ${name.padEnd(9)} ${HASHSCAN}/contract/${address}${entity ? `   (${entity})` : ""}`);
  }

  console.log("\n\x1b[1m5. The tokenised equities and the settlement asset\x1b[0m");
  console.log(`   USDC      ${HASHSCAN}/token/0.0.429274   (Circle's own testnet USDC — we issue nothing)`);
  console.log(`   ATS studio  https://tokenization-studio.hedera.com/`);

  console.log("\n\x1b[1m6. The workflow\x1b[0m");
  console.log(`   https://app.chain.link/cre/workflows`);
  console.log(`   workflow id ${process.env.CRE_WORKFLOW_ID ?? "(set CRE_WORKFLOW_ID)"}\n`);
}

void main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
