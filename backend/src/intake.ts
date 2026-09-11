import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Request, Response } from "express";
import { z } from "zod";
import { config } from "./config";
import { escrow, ledger } from "./hedera";
import { OrderStatus } from "./abis";
import { toBytes32 } from "./eip712";
import { log, short } from "./log";

/**
 * Intake API: the thin, stateless-in-spirit front door.
 *
 * It never sees plaintext. A sealed envelope arrives, is persisted *before* anything else (a
 * crash between receipt and trigger must not strand an order), then handed to the enclave. On
 * restart every envelope whose escrow is still OPEN is re-triggered. The API can censor an
 * order; it cannot read or forge one.
 */

const hex = z.string().regex(/^0x[0-9a-fA-F]+$/);
const b64 = z.string().min(1).regex(/^[A-Za-z0-9+/=_-]+$/);

export const envelopeSchema = z.object({
  /** bytes32, client-chosen; must match the on-chain escrow. */
  orderId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  /** Sealed intent: ECIES(secp256k1 → INTENT_PUBKEY) + AES-256-GCM. */
  envelope: z.object({
    epk: hex, // ephemeral public key, 33-byte compressed hex
    iv: b64, // 12 bytes
    ct: b64, // ciphertext
    tag: b64, // 16-byte GCM tag
  }),
});

export type Envelope = z.infer<typeof envelopeSchema>;

const envelopeDir = path.join(config.dataDir, "envelopes");
const policyDir = path.join(config.dataDir, "policies");
fs.mkdirSync(envelopeDir, { recursive: true });
fs.mkdirSync(policyDir, { recursive: true });

type StoredEnvelope = Envelope & { receivedAt: number; triggers: Array<{ at: number; mode: string; ok: boolean; note?: string }> };

/** One sealed thing to hand the enclave. `triggerIndex` selects the handler registered in
 * cre/tradelayer/main.ts — 0 is H1 intake, 3 is H4 policy. */
type SealedJob = { id: string; dir: string; triggerIndex: number; label: string; payload: unknown };

function envelopePath(orderId: string) {
  return path.join(envelopeDir, `${orderId.toLowerCase()}.json`);
}

function readEnvelope(orderId: string): StoredEnvelope | undefined {
  const p = envelopePath(orderId);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as StoredEnvelope) : undefined;
}

function writeEnvelope(e: StoredEnvelope) {
  fs.writeFileSync(envelopePath(e.orderId), JSON.stringify(e, null, 2), { mode: 0o600 });
}

/* ---------- triggering the enclave ---------- */

async function triggerSimulate(job: SealedJob): Promise<{ ok: boolean; note: string }> {
  const { creProjectDir, creWorkflowDir, creTarget, creBin, creEnvFile, extraPath, allowInsecureRpc } = config.trigger;
  const payloadPath = path.join(job.dir, `${job.id.toLowerCase()}.payload.json`);
  fs.writeFileSync(payloadPath, JSON.stringify(job.payload));

  const args = [
    "workflow",
    "simulate",
    `./${creWorkflowDir}`,
    "--target",
    creTarget,
    "--non-interactive",
    "--trigger-index",
    String(job.triggerIndex),
    "--http-payload",
    payloadPath,
    // Without this the enclave gets no secrets and cannot open the envelope.
    "-e",
    creEnvFile,
    ...(allowInsecureRpc ? ["--allow-insecure-rpc"] : []),
  ];
  const env = { ...process.env, PATH: extraPath ? `${extraPath}:${process.env.PATH ?? ""}` : process.env.PATH };
  const started = Date.now();
  log("enclave", "handing sealed envelope to the TEE handler", { id: short(job.id), trigger: job.label });

  return new Promise(resolve => {
    const child = spawn(creBin, args, { cwd: creProjectDir, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const forward = (chunk: string) => {
      out += chunk;
      // Surface what the enclave itself says as it happens, rather than after it exits. Its own
      // logs never contain order contents — see cre/tradelayer/src/handlers.ts.
      for (const line of chunk.split("\n")) {
        if (line.includes("[USER LOG]")) log("enclave", line.split("[USER LOG]")[1].trim());
        else if (line.includes("Trigger requested TEE Execution")) log("enclave", "TEE execution requested — AWS Nitro, us-west-2");
      }
    };
    child.stdout.on("data", d => forward(d.toString()));
    child.stderr.on("data", d => forward(d.toString()));
    child.on("close", code => {
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const result = out.match(/Workflow Simulation Result:\s*(\{[\s\S]*?\n\})/)?.[1]?.replace(/\s+/g, " ");
      if (code === 0) log("enclave", `${job.label} finished in ${seconds}s`, { result: result ?? "(no result)" });
      else log("warn", `${job.label} failed (exit ${code}) after ${seconds}s — see the transcript`, { id: short(job.id) });
      resolve({ ok: code === 0, note: out.split("\n").slice(-25).join("\n") });
    });
    child.on("error", err => {
      log("warn", "could not start the CRE simulator", { reason: err.message });
      resolve({ ok: false, note: err.message });
    });
  });
}

async function triggerGateway(job: SealedJob): Promise<{ ok: boolean; note: string }> {
  if (!config.trigger.gatewayUrl) return { ok: false, note: "CRE_GATEWAY_URL not set" };
  // Live CRE HTTP trigger: the request must be signed by an authorized key configured on the
  // workflow. Wire the JWT here when the workflow is deployed; simulation is the demo path.
  const res = await fetch(config.trigger.gatewayUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(job.payload),
  });
  return { ok: res.ok, note: `gateway ${res.status}` };
}

async function runJob(job: SealedJob) {
  const mode = config.trigger.mode;
  return mode === "simulate"
    ? await triggerSimulate(job)
    : mode === "gateway"
      ? await triggerGateway(job)
      : { ok: true, note: "trigger disabled" };
}

async function trigger(stored: StoredEnvelope) {
  const result = await runJob({
    id: stored.orderId,
    dir: envelopeDir,
    triggerIndex: 0, // H1 intake is the first handler registered
    label: "H1",
    payload: { orderId: stored.orderId, envelope: stored.envelope },
  });
  stored.triggers.push({ at: Date.now(), mode: config.trigger.mode, ok: result.ok, note: result.note.slice(0, 2_000) });
  writeEnvelope(stored);
  return result;
}

/* ---------- handlers ---------- */

export async function submitOrderHandler(req: Request, res: Response) {
  const parsed = envelopeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid envelope", issues: parsed.error.issues });
    return;
  }
  const { orderId, envelope } = parsed.data;

  // Persist first. The order can be re-triggered from disk; it cannot be recovered from memory.
  const existing = readEnvelope(orderId);
  if (existing) {
    log("intake", "envelope already received, ignoring duplicate", { order: short(orderId) });
    res.status(200).json({ orderId, status: "already-received", triggers: existing.triggers.length });
    return;
  }
  const stored: StoredEnvelope = { orderId, envelope, receivedAt: Date.now(), triggers: [] };
  writeEnvelope(stored);
  log("intake", "sealed envelope received — contents unreadable here", {
    order: short(orderId),
    ciphertext: `${envelope.ct.length}b`,
  });

  // Do not block the client on a multi-second simulation; it polls /orders/:id.
  void trigger(stored);
  res.status(202).json({ orderId, status: "accepted" });
}

export async function orderStatusHandler(req: Request, res: Response) {
  const orderId = String(req.params.orderId ?? "");
  if (!/^0x[0-9a-fA-F]{64}$/.test(orderId)) {
    res.status(400).json({ error: "orderId must be bytes32" });
    return;
  }
  const stored = readEnvelope(orderId);
  const o = await escrow.order(orderId);
  const status = Number(o.status) as OrderStatus;
  res.json({
    orderId,
    onChain: {
      status: OrderStatus[status],
      requester: o.requester,
      amount: o.amount.toString(),
      expiry: Number(o.expiry),
      schedule: o.schedule,
    },
    envelopeReceived: Boolean(stored),
    triggers: stored?.triggers ?? [],
  });
}

/* ---------- policy (org admin) ---------- */

export const policySchema = z.object({
  /** Plain org ticker ("ACME") or an already-encoded bytes32. */
  orgId: z.union([z.string().regex(/^0x[0-9a-fA-F]{64}$/), z.string().min(1).max(31)]),
  envelope: z.object({ epk: hex, iv: b64, ct: b64, tag: b64 }),
});

type StoredPolicy = z.infer<typeof policySchema> & {
  receivedAt: number;
  triggers: Array<{ at: number; mode: string; ok: boolean; note?: string }>;
};

function policyPath(orgId: string) {
  // One file per submission: policies are versioned on-chain, so keep the whole history.
  return path.join(policyDir, `${orgId.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}.json`);
}

/**
 * Sealed rulebook in, enclave out. Like `/orders`, this endpoint cannot read what it forwards —
 * authorship is proved inside the enclave against `OmnibusVault.orgAdmin`, so there is nothing
 * to authenticate here and nothing worth stealing from this process.
 */
export async function submitPolicyHandler(req: Request, res: Response) {
  const parsed = policySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid policy envelope", issues: parsed.error.issues });
    return;
  }
  const { orgId, envelope } = parsed.data;
  const stored: StoredPolicy = { orgId, envelope, receivedAt: Date.now(), triggers: [] };
  fs.writeFileSync(policyPath(orgId), JSON.stringify(stored, null, 2), { mode: 0o600 });
  log("intake", "sealed policy received — rules unreadable here", { org: orgId, ciphertext: `${envelope.ct.length}b` });

  const result = await runJob({
    id: orgId,
    dir: policyDir,
    triggerIndex: 3, // H4 policy — registered last so H1/H2/H3 indices stay put
    label: "H4",
    payload: { orgId, envelope },
  });
  stored.triggers.push({ at: Date.now(), mode: config.trigger.mode, ok: result.ok, note: result.note.slice(0, 2_000) });
  fs.writeFileSync(policyPath(orgId), JSON.stringify(stored, null, 2), { mode: 0o600 });

  res.status(result.ok ? 200 : 502).json({ orgId, applied: result.ok, note: result.note.slice(-600) });
}

export async function policyStatusHandler(req: Request, res: Response) {
  const orgId = String(req.params.orgId ?? "");
  const version = await ledger.policy(toBytes32(orgId)).then((p: { version: bigint }) => Number(p.version)).catch(() => null);
  const p = policyPath(orgId);
  const stored = fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as StoredPolicy) : undefined;
  res.json({ orgId, onChainVersion: version, lastSubmission: stored?.receivedAt ?? null, triggers: stored?.triggers ?? [] });
}

export function enclaveKeyHandler(_req: Request, res: Response) {
  res.json({ intentPublicKey: config.intentPublicKey, chainId: config.hedera.chainId, escrow: config.contracts.escrow });
}

/** On startup: re-trigger any persisted envelope whose escrow is still OPEN. */
export async function recoverPendingEnvelopes() {
  const files = fs.readdirSync(envelopeDir).filter(f => f.endsWith(".json") && !f.endsWith(".payload.json"));
  let retriggered = 0;
  for (const file of files) {
    const stored = JSON.parse(fs.readFileSync(path.join(envelopeDir, file), "utf8")) as StoredEnvelope;
    try {
      const o = await escrow.order(stored.orderId);
      if (Number(o.status) !== OrderStatus.OPEN) continue;
      if (stored.triggers.some(t => t.ok)) continue; // already handed to the enclave once
      await trigger(stored);
      retriggered++;
    } catch (error) {
      console.warn(`[intake] recovery skipped ${stored.orderId}:`, (error as Error).message);
    }
  }
  if (retriggered) console.log(`[intake] re-triggered ${retriggered} pending envelope(s)`);
}
