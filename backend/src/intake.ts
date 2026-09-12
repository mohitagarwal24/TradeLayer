import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Request, Response } from "express";
import { z } from "zod";
import { config } from "./config";
import { escrow, ledger } from "./hedera";
import { OrderStatus } from "./abis";
import { toBytes32 } from "./eip712";
import { execute } from "./creGateway";
import { detail, log, short } from "./log";

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

/** One sealed thing to hand the enclave.
 *
 * `triggerIndex` selects the handler registered in cre/tradelayer/main.ts. H1 and H4 now share
 * trigger 0 — a deployed workflow may register only one HTTP trigger — and the enclave branches
 * on `payload.kind`. The index still matters for `simulate`, which addresses handlers by number;
 * the gateway has no such concept and routes purely on the payload. */
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
      // Surface what the enclave says as it happens, rather than after it exits. These lines are
      // the only place plaintext exists: the enclave holds the intent key, this process does not.
      // CRE does not surface them outside the TEE in a deployed run, which is why the banner
      // below quotes the CLI's own wording rather than paraphrasing it.
      for (const line of chunk.split("\n")) {
        if (line.includes("[USER LOG]")) {
          const said = line.split("[USER LOG]")[1].trim();
          // The broker leg is the hardest part of this system to fake, so give it its own colour
          // rather than burying it in the enclave's stream. It still originates in the enclave.
          if (said.startsWith("broker:")) log("broker", said.replace(/^broker:\s*/, ""));
          else log("enclave", said);
        } else if (line.includes("Trigger requested TEE Execution")) {
          log("enclave", "entering the enclave — AWS Nitro, us-west-2");
          detail([`CRE: "user logs for this trigger will not be visible, and will not leave the TEE"`]);
        }
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
  const result = await execute(job.payload, job.label);
  if (!result.ok) log("warn", `${job.label} was not accepted by the gateway`, { reason: result.note.slice(0, 160) });
  return { ok: result.ok, note: result.note };
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
    triggerIndex: 0, // the one HTTP trigger; `kind` selects the handler inside it
    label: "H1",
    payload: { kind: "order", orderId: stored.orderId, envelope: stored.envelope },
  });
  stored.triggers.push({ at: Date.now(), mode: config.trigger.mode, ok: result.ok, note: result.note.slice(0, 2_000) });
  writeEnvelope(stored);
  return result;
}

/**
 * Show the sealed thing as it actually arrived.
 *
 * The point a demo has to make is that this is not "encrypted somewhere else" — the bytes sitting
 * in this process are opaque *to this process*. Printing the ECIES envelope's real structure, and
 * saying plainly that no key here can open it, is what makes the enclave's output a moment later
 * mean something.
 *
 * `ct` length does reveal plaintext length (AES-GCM is a stream mode). That is a small metadata
 * leak we accept: the escrow amount is already public on-chain, and the evidentiary value here is
 * high. It is not a stand-in for the contents.
 */
function logSealed(what: string, id: string, envelope: Envelope["envelope"]) {
  log("intake", what, { id: short(id, 12) });
  detail([
    `ephemeral key  ${short(envelope.epk, 24)}   (secp256k1, fresh per envelope)`,
    `nonce  ${short(envelope.iv, 16)}    ciphertext  ${envelope.ct.length}B    tag  ${short(envelope.tag, 16)}`,
    `this process holds no key that can open it — decryption happens only inside the enclave`,
  ]);
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
  logSealed("sealed order envelope received", orderId, envelope);

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
  logSealed(`sealed rulebook received for ${orgId}`, orgId, envelope);

  const result = await runJob({
    id: orgId,
    dir: policyDir,
    triggerIndex: 0, // same HTTP trigger as H1; `kind` selects the handler inside it
    label: "H4",
    payload: { kind: "policy", orgId, envelope },
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
      log("warn", "recovery skipped for an envelope", {
        order: short(stored.orderId),
        reason: (error as Error).message.slice(0, 100),
      });
    }
  }
  if (retriggered) log("intake", `re-triggered ${retriggered} pending envelope(s) from disk`);
}
