import { Wallet } from "ethers";
import { buildJwt, buildRequest, canonicalJson } from "../src/creGateway";
import { config } from "../src/config";

/**
 * Sends one signed request to each candidate CRE gateway host and prints the raw answer.
 *
 * The docs list a different host for onchain-registry and private-registry workflows, and the
 * gateway rejects everything the same way ("unauthorized"), so the only reliable way to learn
 * which host serves this workflow is to ask both.
 *
 *   npx tsx scripts/pingGateway.ts
 */

const HOSTS = [
  "https://01.gateway.zone-a.cre.chain.link",
  "https://01.enterprise-gateway.zone-a.cre.chain.link",
];

async function main() {
  const { workflowId, gatewaySigningKey } = config.trigger;
  if (!workflowId) throw new Error("CRE_WORKFLOW_ID not set");
  const wallet = new Wallet(gatewaySigningKey);
  console.log(`workflow ${workflowId}`);
  console.log(`signing as ${wallet.address} — must appear in the workflow's authorizedKeys\n`);

  for (const host of HOSTS) {
    // A deliberately unopenable envelope: we are testing the gateway's acceptance, not the
    // handler's logic. H4 fails closed on it, which is the correct behaviour.
    const req = buildRequest(
      { kind: "policy", orgId: "GWPING", envelope: { epk: "0x02aa", iv: "AAAAAAAAAAAAAAAA", ct: "AAAA", tag: "AAAAAAAAAAAAAAAAAAAAAA==" } },
      workflowId,
    );
    const jwt = await buildJwt(req, wallet);
    process.stdout.write(`${host.padEnd(54)}`);
    try {
      const res = await fetch(host, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
        body: canonicalJson(req),
        signal: AbortSignal.timeout(30_000),
      });
      console.log(`HTTP ${res.status}  ${(await res.text()).slice(0, 400)}`);
    } catch (error) {
      console.log(`unreachable: ${(error as Error).message.slice(0, 140)}`);
    }
  }
}

void main();
