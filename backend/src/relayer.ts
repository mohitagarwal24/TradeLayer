import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import { getAddress } from "ethers";
import { config } from "./config";
import { addressByTarget, contractByTarget } from "./hedera";
import { type Authorization, authorizationSchema, describe, digestFor, recoverSigner, toBytes32 } from "./eip712";
import { log, short } from "./log";

/**
 * Relayer: the only path from the enclave to Hedera.
 *
 * Receives an EIP-712 authorization the enclave signed, verifies the signer locally so a bad
 * payload never costs gas, and submits it with the relayer's hot key. Idempotent by digest — a
 * retried POST for something already relayed returns the earlier receipt. The hot key can censor
 * but cannot forge: every contract re-verifies the enclave signature on-chain.
 */

type RelayRecord = {
  digest: string;
  kind: Authorization["kind"];
  target: keyof typeof contractByTarget;
  status: "pending" | "sent" | "confirmed" | "failed";
  txHash?: string;
  error?: string;
  receivedAt: number;
  updatedAt: number;
};

const relayedDir = path.join(config.dataDir, "relayed");
fs.mkdirSync(relayedDir, { recursive: true });

const inFlight = new Map<string, Promise<RelayRecord>>();

function recordPath(digest: string) {
  return path.join(relayedDir, `${digest}.json`);
}

function readRecord(digest: string): RelayRecord | undefined {
  const p = recordPath(digest);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as RelayRecord) : undefined;
}

function writeRecord(r: RelayRecord) {
  r.updatedAt = Date.now();
  fs.writeFileSync(recordPath(r.digest), JSON.stringify(r, null, 2), { mode: 0o600 });
}

function buildCall(auth: Authorization): { fn: string; args: unknown[] } {
  switch (auth.kind) {
    case "ledgerUpdate":
      return { fn: "update", args: [auth.accountId, auth.enclaveBlob, auth.userBlob, auth.expectedVersion, auth.signature] };
    case "policyUpdate":
      return { fn: "setPolicy", args: [toBytes32(auth.orgId), auth.blob, auth.expectedVersion, auth.signature] };
    case "settle":
      return {
        fn: "settle",
        args: [auth.orderId, auth.spent, auth.enclaveBlob, auth.userBlob, auth.expectedVersion, auth.signature],
      };
    case "cancel":
      return { fn: "cancel", args: [auth.orderId, auth.signature] };
    case "atsMint":
      return { fn: "mintAts", args: [toBytes32(auth.symbol), auth.amount, auth.expectedSupply, auth.signature] };
    case "atsBurn":
      return { fn: "burnAts", args: [toBytes32(auth.symbol), auth.amount, auth.expectedSupply, auth.signature] };
    case "atsTransfer":
      return { fn: "transferAts", args: [toBytes32(auth.symbol), auth.to, auth.amount, auth.nonce, auth.signature] };
    case "payout":
      return { fn: "payout", args: [toBytes32(auth.orgId), auth.to, auth.amount, auth.nonce, auth.signature] };
  }
}

async function submit(auth: Authorization, digest: string, target: keyof typeof contractByTarget): Promise<RelayRecord> {
  const record: RelayRecord = {
    digest,
    kind: auth.kind,
    target,
    status: "pending",
    receivedAt: Date.now(),
    updatedAt: Date.now(),
  };
  writeRecord(record);

  const contract = contractByTarget[target];
  const { fn, args } = buildCall(auth);

  // Cheap pre-flight: the contract itself already consumed this digest.
  if (await contract.usedDigest(digest)) {
    record.status = "confirmed";
    record.txHash = "already-consumed-on-chain";
    writeRecord(record);
    log("relay", "already applied on-chain, nothing to do", { digest: short(digest) });
    return record;
  }

  const overrides = config.relayGasLimit > 0 ? [{ gasLimit: config.relayGasLimit }] : [];
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      log("relay", `submitting ${target}.${fn}()`, {
        attempt: attempt > 1 ? attempt : undefined,
        gas: config.relayGasLimit > 0 ? config.relayGasLimit : "estimated",
      });
      const tx = await contract[fn](...args, ...overrides);
      record.status = "sent";
      record.txHash = tx.hash;
      writeRecord(record);
      log("chain", "tx sent, waiting for receipt", { hash: short(tx.hash, 14) });

      const receipt = await tx.wait();
      record.status = receipt?.status === 1 ? "confirmed" : "failed";
      if (record.status === "failed") record.error = "reverted";
      writeRecord(record);
      if (receipt?.status === 1) {
        log("chain", `${auth.kind} CONFIRMED`, { block: receipt.blockNumber, gasUsed: receipt.gasUsed?.toString() });
      } else {
        log("warn", `${auth.kind} REVERTED — gas used ${receipt?.gasUsed}`, { hash: short(tx.hash, 14) });
      }
      return record;
    } catch (error) {
      lastError = error;
      const message = (error as Error).message ?? String(error);
      // Deterministic reverts (stale version, already processed) will not succeed on retry.
      if (/VersionMismatch|SupplyMismatch|OrderNotOpen|DigestAlreadyUsed|InvalidEnclaveSignature/.test(message)) {
        log("warn", `${auth.kind} rejected by the contract — not retrying`, { reason: message.slice(0, 120) });
        break;
      }
      log("warn", `${auth.kind} attempt ${attempt} failed, retrying`, { reason: message.slice(0, 120) });
      await new Promise(resolve => setTimeout(resolve, attempt * 2_000));
    }
  }
  record.status = "failed";
  record.error = (lastError as Error)?.message ?? String(lastError);
  writeRecord(record);
  return record;
}

export async function relayHandler(req: Request, res: Response) {
  const parsed = authorizationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid authorization", issues: parsed.error.issues });
    return;
  }
  const auth = parsed.data;
  const { target } = describe(auth);
  const verifyingContract = addressByTarget[target];

  log("relay", `authorization received: ${auth.kind} → ${target}`);

  let signer: string;
  try {
    signer = recoverSigner(auth, config.hedera.chainId, verifyingContract);
  } catch (error) {
    log("warn", "malformed signature, refusing", { reason: (error as Error).message.slice(0, 100) });
    res.status(400).json({ error: `bad signature: ${(error as Error).message}` });
    return;
  }
  if (signer !== getAddress(config.enclaveSigner)) {
    // The whole point of the design: anything the enclave did not sign dies here, unspent.
    log("warn", "NOT signed by the enclave — refusing to spend gas", { recovered: signer });
    res.status(403).json({ error: "not signed by the enclave", recovered: signer });
    return;
  }
  log("relay", "enclave signature verified", { signer: short(signer, 12) });

  const digest = digestFor(auth, config.hedera.chainId, verifyingContract);
  const existing = readRecord(digest);
  if (existing && existing.status !== "failed") {
    // A cached receipt only means something if the chain still agrees with it. This store
    // outlives chain resets and redeployments, and the ATS batch digests are low-entropy —
    // (symbol, amount, expectedSupply) repeats run to run, unlike a settlement carrying a random
    // orderId — so a stale "confirmed" here would silently suppress a real mint and leave the
    // reserve unbacked. Ask the contract before short-circuiting; it is one eth_call.
    const consumed = await contractByTarget[target].usedDigest(digest).catch(() => false);
    if (consumed) {
      log("relay", "duplicate authorization, returning earlier result", { status: existing.status });
      res.status(200).json(existing);
      return;
    }
    log("relay", "cached receipt is stale — the chain has not consumed this digest, resubmitting", {
      digest: short(digest),
    });
  }

  let pending = inFlight.get(digest);
  if (!pending) {
    pending = submit(auth, digest, target).finally(() => inFlight.delete(digest));
    inFlight.set(digest, pending);
  }
  const record = await pending;
  res.status(record.status === "failed" ? 502 : 200).json(record);
}

export function relayStatusHandler(req: Request, res: Response) {
  const digest = String(req.params.digest ?? "");
  const record = /^0x[0-9a-fA-F]{64}$/.test(digest) ? readRecord(digest) : undefined;
  if (!record) {
    res.status(404).json({ error: "unknown digest" });
    return;
  }
  res.json(record);
}
