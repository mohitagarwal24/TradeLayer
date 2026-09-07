/**
 * Partial redemption proof after a settled notional buy.
 * Usage: cd backend && RECEIPT_UNITS=200 SYMBOL=TSLA npx tsx scripts/notionalRedeemProof.ts
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { AbiCoder, Contract, JsonRpcProvider, Wallet } from "ethers";
import { deriveAESKey } from "../decrypt";
import { getPosition } from "../components/orderStore";

const RPC = process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api";
const BACKEND_API = process.env.BACKEND_API ?? "http://localhost:8000";
const TRADE_LAYER = process.env.contract!;
const SYMBOL = (process.env.SYMBOL ?? "TSLA").toUpperCase();
const UNITS = Number(process.env.RECEIPT_UNITS ?? "200");
const abi = new AbiCoder();

async function fetchPrivatePosition(wallet: Wallet) {
  const timestamp = Date.now().toString();
  const message = `TradeLayer private portfolio\nAddress: ${wallet.address}\nTimestamp: ${timestamp}`;
  const signature = await wallet.signMessage(message);
  const response = await fetch(`${BACKEND_API}/private-portfolio/${wallet.address}`, {
    headers: {
      "X-PORTFOLIO-TIMESTAMP": timestamp,
      "X-PORTFOLIO-SIGNATURE": signature,
    },
  });
  if (!response.ok) throw new Error(`Private portfolio API returned ${response.status}`);
  const body = (await response.json()) as {
    positions: Array<{ symbol: string; shares: number; receiptUnits: number }>;
  };
  return body.positions.find(position => position.symbol === SYMBOL);
}

async function seal(intent: object, backendPublicKeyB64: string) {
  const keypair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveKey",
  ]);
  const jwkJson = Buffer.from(backendPublicKeyB64, "base64").toString("utf8");
  const backendPublic = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(jwkJson),
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
  const aesKey = await deriveAESKey(keypair.privateKey as any, backendPublic);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    new TextEncoder().encode(JSON.stringify(intent)),
  );
  const toB64 = (buf: ArrayBuffer | Uint8Array) =>
    Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString("base64");
  const encryptedOrder = abi.encode(
    ["tuple(string cipherText,string iv)"],
    [{ cipherText: toB64(ciphertext), iv: toB64(iv) }],
  );
  const pubJwk = await crypto.subtle.exportKey("jwk", keypair.publicKey);
  const ephemeralPublicKeyB64 = Buffer.from(JSON.stringify(pubJwk)).toString("base64");
  return { encryptedOrder, ephemeralPublicKeyB64 };
}

async function main() {
  if (!process.env.private_key || !TRADE_LAYER) throw new Error("Need private_key + contract");
  if (!Number.isSafeInteger(UNITS) || UNITS <= 0) throw new Error("RECEIPT_UNITS must be positive int");

  const provider = new JsonRpcProvider(RPC, { chainId: 296, name: "hedera-testnet" }, { staticNetwork: true });
  const wallet = new Wallet(process.env.private_key, provider);
  const tradeLayer = new Contract(
    TRADE_LAYER,
    [
      "function redeemStock(string orderId,string encryptedOrder,uint256 amount)",
      "function balanceOf(address) view returns (uint256)",
      "function orderProcessed(string) view returns (bool)",
    ],
    wallet,
  );

  const privatePos = getPosition(wallet.address, SYMBOL);
  console.log("Private position:", privatePos);
  console.log("On-chain DSTOCK:", (await tradeLayer.balanceOf(wallet.address)).toString());
  if (!privatePos || privatePos.receiptUnits < UNITS) {
    throw new Error(`Need at least ${UNITS} private ${SYMBOL} receipt units (wait for buy fill)`);
  }

  const pubRes = await fetch(`${BACKEND_API}/public-key`);
  const { publicKey } = (await pubRes.json()) as { publicKey: string };
  const orderId = randomUUID();
  const sealed = await seal({ stock: SYMBOL, qty: UNITS, side: "sell", orderType: "market" }, publicKey);
  await fetch(`${BACKEND_API}/ephemeral-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, publicKey: sealed.ephemeralPublicKeyB64 }),
  });

  console.log(`Redeeming ${UNITS} units ($${(UNITS / 100).toFixed(2)}) of ${SYMBOL}`);
  const tx = await tradeLayer.redeemStock(orderId, sealed.encryptedOrder, UNITS);
  console.log("redeemStock tx:", tx.hash);
  await tx.wait();

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await tradeLayer.orderProcessed(orderId)) {
      console.log("SETTLED redeem. Remaining DSTOCK:", (await tradeLayer.balanceOf(wallet.address)).toString());
      console.log("Remaining private:", await fetchPrivatePosition(wallet));
      return;
    }
    await new Promise(r => setTimeout(r, 5000));
    process.stdout.write(".");
  }
  console.log("\nRedeem not settled within 3 minutes. orderId:", orderId);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
