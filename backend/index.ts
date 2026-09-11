import express from "express";
import { getAddress } from "ethers";
import { config } from "./src/config";
import { addressByTarget, contractByTarget, relayerWallet } from "./src/hedera";
import { relayHandler, relayStatusHandler } from "./src/relayer";
import {
  enclaveKeyHandler,
  orderStatusHandler,
  policyStatusHandler,
  recoverPendingEnvelopes,
  submitOrderHandler,
  submitPolicyHandler,
} from "./src/intake";
import {
  complianceStatusHandler,
  marketClockHandler,
  marketHandler,
  orgStatusHandler,
  walletStatusHandler,
} from "./src/org";
import { startChainNarration } from "./src/watch";
import { log } from "./src/log";

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", config.frontendOrigin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Intake (client-facing): sealed envelopes in, status out. Never sees plaintext.
app.get("/enclave-key", enclaveKeyHandler);
app.post("/orders", submitOrderHandler);
app.get("/orders/:orderId", orderStatusHandler);

// Institution admin: the sealed rulebook. Authorship is proved inside the enclave.
app.post("/policy", submitPolicyHandler);
app.get("/policy/:orgId", policyStatusHandler);

// Public status the web app reads. None of this can reveal a balance or a position.
app.get("/wallet/:address", walletStatusHandler);
app.get("/org/:orgId", orgStatusHandler);
app.get("/compliance/:address", complianceStatusHandler);
app.get("/market", marketHandler);
app.get("/market/clock", marketClockHandler);

// Relayer (enclave-facing): enclave-signed authorizations in, transactions out.
app.post("/relay", relayHandler);
app.get("/relay/:digest", relayStatusHandler);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    relayer: relayerWallet.address,
    chainId: config.hedera.chainId,
    contracts: config.contracts,
    symbols: config.symbols,
  });
});

/**
 * Confirm every contract trusts the enclave key this process expects — a mismatch means nothing
 * the enclave signs will ever be accepted, and it is far better to say so at startup than to have
 * every settlement fail later for no visible reason.
 *
 * Hashio drops requests often enough that a single failure means nothing, so retry before
 * believing it. Returns whether the check actually completed.
 */
async function assertContractsTrustTheEnclave(attempts = 3): Promise<boolean> {
  const expected = getAddress(config.enclaveSigner);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      for (const [name, contract] of Object.entries(contractByTarget)) {
        const onChain = getAddress(await contract.enclaveSigner());
        if (onChain !== expected) {
          log(
            "warn",
            `${name} (${addressByTarget[name as keyof typeof addressByTarget]}) trusts ${onChain}, but this backend signs as ${expected}. Nothing will settle until they match.`,
          );
          return false;
        }
      }
      log("enclave", `signer ${config.enclaveSigner} verified on escrow, ledger and vault`);
      return true;
    } catch (error) {
      const reason = (error as Error)?.message?.trim() || "no response from the RPC";
      if (attempt === attempts) {
        log("warn", `could not reach the contracts to verify the enclave signer: ${reason.slice(0, 140)}`);
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, attempt * 1_500));
    }
  }
  return false;
}

app.listen(config.port, async () => {
  log("intake", `TradeLayer on http://localhost:${config.port}`);
  log("relay", `relayer ${relayerWallet.address} → chain ${config.hedera.chainId}`);
  log("intake", `tradeable: ${config.symbols.join(", ")}  ·  enclave trigger: ${config.trigger.mode}`);
  // The signer check is advisory. A flaky RPC must not leave the process running blind, so
  // narration and envelope recovery start either way.
  await assertContractsTrustTheEnclave();
  try {
    await startChainNarration();
  } catch (error) {
    log("warn", `chain narration did not start: ${((error as Error)?.message ?? "").slice(0, 140)}`);
  }
  try {
    await recoverPendingEnvelopes();
  } catch (error) {
    log("warn", `envelope recovery skipped: ${((error as Error)?.message ?? "").slice(0, 140)}`);
  }
});

export { app };
