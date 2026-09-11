/**
 * Headless org-admin client — publishes the company's private rulebook.
 *
 *   bun scripts/setPolicy.ts                    # demo policy: employee #2 may buy, #3 may not
 *   bun scripts/setPolicy.ts ./my-policy.json   # or supply your own Policy document
 *
 * 1. read the current policy version from the ledger (the on-chain replay guard)
 * 2. EIP-712-sign the rules  (domain TradeLayerIntent, verifying contract = the *vault*, because
 *    that is where `orgAdmin` lives)
 * 3. seal them to the enclave's public key so the intake API forwards rules it cannot read
 * 4. POST to /policy, which triggers H4 inside the TEE
 *
 * Config comes from $CRE_CONFIG (default config/config.testnet.json); the admin key from
 * $ADMIN_KEY, the institution from $ORG_ID, and the two demo employees from $EMPLOYEE_1/$EMPLOYEE_2.
 */
import { createPublicClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "@noble/hashes/utils";
import { chainFor } from "./chain";
const config = (await import(process.env.CRE_CONFIG ?? "../config/config.testnet.json")).default as {
  hedera: { chainId: number; rpcUrl: string; ledger: string; vault: string; registry: string };
};
import { bytes32, fromHex, policyHash, sealEnvelope, toHex } from "../src/crypto";
import type { Policy } from "../src/ledger";

const INTAKE = process.env.INTAKE_URL ?? "http://localhost:8000";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name}`);
  return v;
}

const ADMIN_KEY = env("ADMIN_KEY").replace(/^(?!0x)/, "0x") as Hex;
const ORG_ID = process.env.ORG_ID ?? "ACME";
const EMPLOYEE_1 = (process.env.EMPLOYEE_1 ?? "").toLowerCase();
const EMPLOYEE_2 = (process.env.EMPLOYEE_2 ?? "").toLowerCase();

const LEDGER = parseAbi(["function policy(bytes32 orgId) view returns ((bytes blob, uint64 version))"]);
const REGISTRY = parseAbi(["function adminOf(bytes32 orgId) view returns (address)"]);

/** Employee 1 may buy anything but VOO, up to 1,000 USDC; employee 2 is blocked outright.
 * `dailyCap: "0"` means no limit, and is not enforced yet in any case — see the Policy type. */
function demoPolicy(): Policy {
  const employees: Policy["employees"] = {};
  if (EMPLOYEE_1) employees[EMPLOYEE_1] = { canBuy: true, canSell: true, dailyCap: "0", restricted: ["VOO"] };
  if (EMPLOYEE_2) employees[EMPLOYEE_2] = { canBuy: false, canSell: false, dailyCap: "0", restricted: [] };
  if (Object.keys(employees).length === 0) {
    throw new Error("Set EMPLOYEE_1 (and optionally EMPLOYEE_2), or pass a policy JSON file");
  }
  return { v: 1, employees, maxOrderNotional: "1000000000", allowWithdrawShares: false };
}

const log = (...a: unknown[]) => console.log(...a);

async function main() {
  const file = process.argv[2];
  const policy: Policy = file ? JSON.parse(await Bun.file(file).text()) : demoPolicy();
  const { hedera } = config;

  const admin = privateKeyToAccount(ADMIN_KEY);
  const publicClient = createPublicClient({ chain: chainFor(hedera.chainId, hedera.rpcUrl), transport: http(hedera.rpcUrl) });
  log(`admin         ${admin.address}`);

  const onChainAdmin = await publicClient.readContract({
    address: hedera.registry as Hex,
    abi: REGISTRY,
    functionName: "adminOf",
    args: [toHex(bytes32(ORG_ID))],
  });
  log(`registry says ${onChainAdmin}`);
  if (onChainAdmin.toLowerCase() !== admin.address.toLowerCase()) {
    throw new Error(`this key is not ${ORG_ID}'s admin — the enclave will reject the policy`);
  }

  const current = await publicClient.readContract({
    address: hedera.ledger as Hex,
    abi: LEDGER,
    functionName: "policy",
    args: [toHex(bytes32(ORG_ID))],
  });
  const version = Number(current.version);
  log(`policy now    v${version} (${current.blob.length / 2 - 1} bytes of ciphertext)`);

  // The nonce must exceed the on-chain version so a resubmission of older rules cannot land.
  const nonce = version + 1;
  const unsigned = { v: 1 as const, orgId: ORG_ID, admin: admin.address, policy, nonce };
  const sig = await admin.signTypedData({
    domain: { name: "TradeLayerIntent", version: "1", chainId: hedera.chainId, verifyingContract: hedera.vault as Hex },
    types: {
      PolicyIntent: [
        { name: "orgId", type: "bytes32" },
        { name: "admin", type: "address" },
        { name: "policyHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
      ],
    },
    primaryType: "PolicyIntent",
    message: {
      orgId: toHex(bytes32(ORG_ID)),
      admin: admin.address,
      policyHash: toHex(policyHash(policy)),
      nonce: BigInt(nonce),
    },
  });

  const enclave = (await (await fetch(`${INTAKE}/enclave-key`)).json()) as { intentPublicKey: Hex };
  const envelope = sealEnvelope(
    new TextEncoder().encode(JSON.stringify({ ...unsigned, sig })),
    fromHex(enclave.intentPublicKey),
    randomBytes(32),
    randomBytes(12),
  );
  log(`sealed        ${envelope.ct.length}b of ciphertext — the intake API cannot read these rules`);

  const res = await fetch(`${INTAKE}/policy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orgId: ORG_ID, envelope }),
  });
  const body = (await res.json()) as { applied?: boolean; note?: string };
  log(`intake        HTTP ${res.status} applied=${body.applied}`);

  const after = await publicClient.readContract({
    address: hedera.ledger as Hex,
    abi: LEDGER,
    functionName: "policy",
    args: [toHex(bytes32(ORG_ID))],
  });
  log(`policy now    v${Number(after.version)} (${after.blob.length / 2 - 1} bytes of ciphertext)`);
  if (Number(after.version) !== version + 1) {
    log(`\n--- enclave transcript tail ---\n${body.note ?? "(none)"}`);
    process.exit(1);
  }
  log(`\n✓ rulebook stored encrypted on-chain. Nothing above revealed a rule.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
