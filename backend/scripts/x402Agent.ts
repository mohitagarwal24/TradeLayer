/**
 * Autonomous agent that discovers the x402-gated order-status API, pays via
 * Blocky402 on Hedera testnet, and completes one paid request end-to-end.
 *
 * Env:
 *   BACKEND_URL          default http://localhost:8000
 *   HEDERA_ACCOUNT_ID    payer account (0.0.x)
 *   HEDERA_PRIVATE_KEY   ECDSA private key for that account
 *   AGENT_PORTFOLIO_ADDRESS optional EVM address to query (defaults to payer)
 */
import "dotenv/config";
import { ExactHederaScheme, createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { Wallet } from "ethers";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const FACILITATOR = process.env.X402_FACILITATOR_URL ?? "https://api.testnet.blocky402.com";

async function main() {
  const accountId = process.env.X402_PAYER_ACCOUNT_ID ?? process.env.HEDERA_ACCOUNT_ID;
  const privateKey = process.env.X402_PAYER_PRIVATE_KEY ?? process.env.HEDERA_PRIVATE_KEY;
  if (!accountId || !privateKey) {
    throw new Error("Set X402_PAYER_ACCOUNT_ID and X402_PAYER_PRIVATE_KEY");
  }

  const portfolioAddress =
    process.env.AGENT_PORTFOLIO_ADDRESS ??
    new Wallet(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`).address;
  const url = `${BACKEND}/portfolio/${portfolioAddress}`;
  console.log("1. Probe unpaid resource:", url);
  const probe = await fetch(url);
  console.log("   status:", probe.status);
  const body = (await probe.json()) as {
    accepts?: Array<Record<string, unknown>>;
    resource?: {
      url: string;
      description?: string;
      mimeType?: string;
      serviceName?: string;
    };
  };
  if (probe.status !== 402 || !body.accepts?.[0]) {
    throw new Error(`Expected 402 with accepts[], got ${probe.status}`);
  }

  const requirements = body.accepts[0] as {
    scheme: string;
    network: `${string}:${string}`;
    amount: string;
    payTo: string;
    maxTimeoutSeconds: number;
    asset: string;
    extra: { feePayer: string };
  };
  console.log("2. Payment required:", requirements);

  // Refresh feePayer from facilitator in case the resource server is stale.
  const supported = await fetch(`${FACILITATOR}/supported`).then((r) => r.json());
  const kind = supported.kinds?.find((k: { network: string }) => k.network === "hedera:testnet");
  const feePayer = kind?.extra?.feePayer ?? supported.signers?.["hedera:*"]?.[0] ?? requirements.extra.feePayer;
  requirements.extra = { feePayer };

  console.log("3. Sign x402 payment payload…");
  const signer = createClientHederaSigner(accountId, PrivateKey.fromStringECDSA(privateKey), {
    network: "hedera:testnet",
  });
  const scheme = new ExactHederaScheme(signer);
  const signed = await scheme.createPaymentPayload(2, requirements);
  const paymentPayload = {
    x402Version: 2,
    resource: body.resource,
    accepted: requirements,
    payload: signed.payload,
  };

  const paymentSignature = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");
  console.log("4. Retry with PAYMENT-SIGNATURE…");
  const paid = await fetch(url, { headers: { "PAYMENT-SIGNATURE": paymentSignature } });
  const result = await paid.json();
  console.log("   status:", paid.status);
  console.log("   body:", JSON.stringify(result, null, 2));

  if (!paid.ok) {
    process.exit(1);
  }
  console.log("\nAgent paid request complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
