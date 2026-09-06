/**
 * x402 paywall for TradeLayer data APIs.
 * Facilitator: Blocky402 hosted testnet (https://api.testnet.blocky402.com).
 * Settlement asset defaults to HTS USDC (0.0.429274); override with X402_ASSET.
 */
import type { Request, Response, NextFunction } from "express";
import { TopicMessageSubmitTransaction, Client, PrivateKey, AccountId } from "@hashgraph/sdk";

const FACILITATOR = process.env.X402_FACILITATOR_URL ?? "https://api.testnet.blocky402.com";
const NETWORK = "hedera:testnet";
const PAY_TO = process.env.X402_PAY_TO ?? ""; // Hedera account id e.g. 0.0.xxxxx
// Circle USDC on Hedera testnet (HTS). Extra points for HTS in settlement path.
const ASSET = process.env.X402_ASSET ?? "0.0.429274";
// 0.01 USDC (6 decimals) or 100000 tinybars if asset is HBAR (0.0.0)
const AMOUNT = process.env.X402_AMOUNT ?? "10000";

type PaymentRequirements = {
  scheme: string;
  network: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { feePayer: string };
};

let cachedFeePayer: string | null = null;

async function getFeePayer(): Promise<string> {
  if (cachedFeePayer) return cachedFeePayer;
  const res = await fetch(`${FACILITATOR}/supported`);
  if (!res.ok) throw new Error(`facilitator /supported ${res.status}`);
  const data = (await res.json()) as {
    kinds: Array<{ network: string; extra?: { feePayer?: string } }>;
    signers?: Record<string, string[]>;
  };
  const kind = data.kinds.find((k) => k.network === NETWORK);
  cachedFeePayer = kind?.extra?.feePayer ?? data.signers?.["hedera:*"]?.[0] ?? "";
  if (!cachedFeePayer) throw new Error("facilitator did not advertise a Hedera feePayer");
  return cachedFeePayer;
}

export async function buildRequirements(): Promise<PaymentRequirements> {
  if (!PAY_TO) throw new Error("Set X402_PAY_TO to your Hedera testnet account id (0.0.x)");
  const feePayer = await getFeePayer();
  return {
    scheme: "exact",
    network: NETWORK,
    amount: AMOUNT,
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    asset: ASSET,
    extra: { feePayer },
  };
}

function decodePaymentHeader(header: string | undefined): unknown | null {
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function verifyAndSettle(paymentPayload: unknown, paymentRequirements: PaymentRequirements) {
  const body = JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements });
  const verify = await fetch(`${FACILITATOR}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }).then((r) => r.json() as Promise<{ isValid?: boolean; invalidMessage?: string; payer?: string }>);

  if (!verify.isValid) {
    throw new Error(verify.invalidMessage ?? "payment verification failed");
  }

  const settle = await fetch(`${FACILITATOR}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }).then(
    (r) =>
      r.json() as Promise<{ success?: boolean; transaction?: string; errorMessage?: string; network?: string }>,
  );

  if (!settle.success) {
    throw new Error(settle.errorMessage ?? "payment settlement failed");
  }
  return settle;
}

/** Append a payment receipt to an HCS topic when configured (extra prize points). */
async function appendHcsAudit(record: Record<string, unknown>) {
  const topicId = process.env.HCS_AUDIT_TOPIC;
  const accountId = process.env.HEDERA_ACCOUNT_ID;
  const privateKey = process.env.HEDERA_PRIVATE_KEY;
  if (!topicId || !accountId || !privateKey) {
    console.log("HCS audit skipped (set HCS_AUDIT_TOPIC + HEDERA_ACCOUNT_ID + HEDERA_PRIVATE_KEY)");
    return;
  }

  const client = Client.forTestnet().setOperator(AccountId.fromString(accountId), PrivateKey.fromStringECDSA(privateKey));
  try {
    const submit = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify({ ts: Date.now(), ...record }))
      .execute(client);
    const receipt = await submit.getReceipt(client);
    console.log("HCS audit posted, status:", receipt.status.toString());
  } finally {
    client.close();
  }
}

/**
 * Express middleware: requires a settled x402 payment (Blocky402) before
 * handing the request to the route handler.
 */
export function requireX402Payment(description: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requirements = await buildRequirements();
      const paymentPayload = decodePaymentHeader(req.header("X-PAYMENT") ?? undefined);

      if (!paymentPayload) {
        res.status(402).json({
          x402Version: 2,
          error: "Payment Required",
          accepts: [requirements],
          description,
          resource: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
        });
        return;
      }

      const settlement = await verifyAndSettle(paymentPayload, requirements);
      (req as Request & { x402Settlement?: unknown }).x402Settlement = settlement;

      await appendHcsAudit({
        path: req.originalUrl,
        description,
        transaction: settlement.transaction,
        network: settlement.network ?? NETWORK,
        asset: requirements.asset,
        amount: requirements.amount,
        payTo: requirements.payTo,
      });

      next();
    } catch (err) {
      console.error("x402 gate error:", err);
      res.status(402).json({
        x402Version: 2,
        error: (err as Error).message,
        accepts: await buildRequirements().catch(() => []),
      });
    }
  };
}
