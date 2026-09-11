import { cre, handlerInTee, Runner, type TeeConstraint } from "@chainlink/cre-sdk";
import { type Config, configSchema } from "./src/config";
import { onBatch, onIntake, onPolicy, onReconcile } from "./src/handlers";

/**
 * TradeLayer — confidential settlement workflow.
 *
 * Every handler is registered with `handlerInTee`: sealed orders are opened, private
 * portfolios and company rules are read, the broker is called with enclave-held credentials,
 * and settlements are signed — all inside an AWS Nitro enclave. The chain, the relayer and the
 * operator see only ciphertext and signatures.
 *
 *   trigger 0  H1 intake     HTTP   { orderId, envelope }
 *   trigger 1  H2 reconcile  cron   polls fills, signs atomic settlements
 *   trigger 2  H3 batch      cron   reconciles ATS supply with broker positions
 *   trigger 3  H4 policy     HTTP   { orgId, envelope } — the org admin's sealed rulebook
 *
 * H4 is registered last so the indices the intake API triggers by (0) and the demo runbook
 * uses (1, 2) stay put.
 */

const TEE: TeeConstraint = [{ tee: "nitro", regions: ["us-west-2"] }];

const initWorkflow = (config: Config) => {
  const http = new cre.capabilities.HTTPCapability();
  const cron = new cre.capabilities.CronCapability();
  return [
    handlerInTee(http.trigger({ authorizedKeys: [] }), onIntake, TEE),
    handlerInTee(cron.trigger({ schedule: config.reconcileSchedule }), onReconcile, TEE),
    handlerInTee(cron.trigger({ schedule: config.batchSchedule }), onBatch, TEE),
    handlerInTee(http.trigger({ authorizedKeys: [] }), onPolicy, TEE),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}

main();
