/**
 * Autonomous agent that discovers the x402-gated order-status API, pays via
 * Blocky402 on Hedera testnet, and completes one paid request end-to-end.
 *
 * Env:
 *   BACKEND_URL          default http://localhost:8000
 *   HEDERA_ACCOUNT_ID    payer account (0.0.x)
 *   HEDERA_PRIVATE_KEY   ECDSA private key for that account
 *   ORDER_ID             order to query (any string the contract knows, or demo id)
 */
import { ExactHederaScheme, createClientHederaSigner, PrivateKey } from "@x402/hedera";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const FACILITATOR = process.env.X402_FACILITATOR_URL ?? "https://api.testnet.blocky402.com";
const ORDER_ID = process.env.ORDER_ID ?? "demo-order";

async function main() {
  const accountId = process.env.HEDERA_ACCOUNT_ID;
  const privateKey = process.env.HEDERA_PRIVATE_KEY;
  if (!accountId || !privateKey) {
    throw new Error("Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY");
  }

  const url = `${BACKEND}/order-status/${encodeURIComponent(ORDER_ID)}`;
  console.log("1. Probe unpaid resource:", url);
  const probe = await fetch(url);
  console.log("   status:", probe.status);
  const body = (await probe.json()) as {
    accepts?: Array<Record<string, unknown>>;
    description?: string;
  };
  if (probe.status !== 402 || !body.accepts?.[0]) {
    throw new Error(`Expected 402 with accepts[], got ${probe.status}`);
  }

  const requirements = body.accepts[0] as {
    scheme: string;
    network: string;
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
    scheme: "exact",
    network: "hedera:testnet",
    accepted: requirements,
    payload: signed.payload,
  };

  const xPayment = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");
  console.log("4. Retry with X-PAYMENT…");
  const paid = await fetch(url, { headers: { "X-PAYMENT": xPayment } });
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
