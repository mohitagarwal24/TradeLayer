import { cre, handlerInTee, Runner, type TeeConstraint } from "@chainlink/cre-sdk";
import { type Config, configSchema } from "./src/config";
import { onBatch, onHttp, onReconcile } from "./src/handlers";

/**
 * TradeLayer — confidential settlement workflow.
 *
 * Every handler is registered with `handlerInTee`: sealed orders are opened, private
 * portfolios and company rules are read, the broker is called with enclave-held credentials,
 * and settlements are signed — all inside an AWS Nitro enclave. The chain, the relayer and the
 * operator see only ciphertext and signatures.
 *
 *   trigger 0  HTTP   H1 intake { kind: "order", orderId, envelope }
 *                     H4 policy { kind: "policy", orgId, envelope }
 *   trigger 1  cron   H2 reconcile — polls fills, signs atomic settlements
 *   trigger 2  cron   H3 batch — reconciles ATS supply with broker positions
 *
 * H1 and H4 share trigger 0 because a *deployed* workflow may register only one HTTP trigger;
 * `onHttp` branches on `kind`. Simulation would happily run two, which is why this only shows
 * up at deploy time. The cron indices are unchanged.
 */

const TEE: TeeConstraint = [{ tee: "nitro", regions: ["us-west-2"] }];

const initWorkflow = (config: Config) => {
  const http = new cre.capabilities.HTTPCapability();
  const cron = new cre.capabilities.CronCapability();
  // Deployed, the HTTP trigger is a public endpoint on Chainlink's gateway: without this list
  // anyone who found it could make the enclave place broker orders against an institution's
  // money. The gateway verifies a JWT signed by one of these addresses before the enclave runs.
  const authorizedKeys = config.authorizedKeys.map(publicKey => ({
    type: "KEY_TYPE_ECDSA_EVM" as const,
    publicKey,
  }));
  return [
    handlerInTee(http.trigger({ authorizedKeys }), onHttp, TEE),
    handlerInTee(cron.trigger({ schedule: config.reconcileSchedule }), onReconcile, TEE),
    handlerInTee(cron.trigger({ schedule: config.batchSchedule }), onBatch, TEE),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}

main();
