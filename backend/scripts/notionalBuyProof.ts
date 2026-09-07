/**
 * Hedera testnet $5 notional buy proof (exact USDC → Alpaca notional).
 * Usage: cd backend && npx tsx scripts/notionalBuyProof.ts
 *
 * Requires market hours for fill; outside hours the day order is submitted and
 * will fill at the next open (backend settles on fill).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { AbiCoder, Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from "ethers";
import { deriveAESKey } from "../decrypt";

const RPC = process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api";
const BACKEND_API = process.env.BACKEND_API ?? "http://localhost:8000";
const TRADE_LAYER = process.env.contract!;
const USDC = "0x0000000000000000000000000000000000068cDa";
const BUY_USDC = 5_000_000n; // $5.00
const abi = new AbiCoder();

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
  if (!process.env.private_key || !TRADE_LAYER) throw new Error("Need private_key + contract in .env");

  const provider = new JsonRpcProvider(RPC, { chainId: 296, name: "hedera-testnet" }, { staticNetwork: true });
  const wallet = new Wallet(process.env.private_key, provider);
  const usdc = new Contract(
    USDC,
    ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "function balanceOf(address) view returns (uint256)"],
    wallet,
  );
  const tradeLayer = new Contract(
    TRADE_LAYER,
    [
      "function buyStock(string orderId,string encryptedOrder,uint256 amountOfUsdc)",
      "function balanceOf(address) view returns (uint256)",
      "function requests(string) view returns (address,uint256,uint256,bool)",
      "function orderProcessed(string) view returns (bool)",
    ],
    wallet,
  );

  console.log("Buyer:", wallet.address);
  console.log("TradeLayer:", TRADE_LAYER);
  console.log("USDC balance:", (await usdc.balanceOf(wallet.address)).toString());
  console.log("DSTOCK before:", (await tradeLayer.balanceOf(wallet.address)).toString());

  const pubRes = await fetch(`${BACKEND_API}/public-key`);
  if (!pubRes.ok) throw new Error(`/public-key ${pubRes.status}`);
  const { publicKey } = (await pubRes.json()) as { publicKey: string };

  const orderId = randomUUID();
  const sealed = await seal({ stock: "TSLA", qty: 0, side: "buy", orderType: "market" }, publicKey);

  await fetch(`${BACKEND_API}/ephemeral-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, publicKey: sealed.ephemeralPublicKeyB64 }),
  });

  const allowance = await usdc.allowance(wallet.address, TRADE_LAYER);
  if (allowance < BUY_USDC) {
    console.log("Approving USDC…");
    await (await usdc.approve(TRADE_LAYER, BUY_USDC * 10n)).wait();
  }

  console.log(`Submitting $5.00 notional buy ${orderId}`);
  const tx = await tradeLayer.buyStock(orderId, sealed.encryptedOrder, BUY_USDC);
  console.log("buyStock tx:", tx.hash);
  await tx.wait();
  console.log("Escrowed. Waiting for Alpaca fill + settlement (up to 3 min)…");

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const processed = await tradeLayer.orderProcessed(orderId);
    if (processed) {
      const bal = await tradeLayer.balanceOf(wallet.address);
      console.log("SETTLED. DSTOCK receipt units:", bal.toString(), `($${(Number(bal) / 100).toFixed(2)})`);
      return;
    }
    await new Promise(r => setTimeout(r, 5000));
    process.stdout.write(".");
  }
  console.log("\nNot settled within 3 minutes (market may be closed). Order remains escrowed:");
  console.log("orderId:", orderId);
  console.log("Check backend logs / Alpaca paper dashboard for day-order status.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
