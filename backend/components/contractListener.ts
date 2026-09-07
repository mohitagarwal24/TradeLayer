import { contract } from "./contract";
import dotenv from "dotenv";
import { importKeyFromEnv, deriveAESKey, decrypt } from "../decrypt";
import { getBackendEcdhJwk } from "./backendKeys";
import { getEphemeralKey } from "./keyExchange";
import { AbiCoder } from "ethers";
import { createBuyOrder, createSellOrder } from "./alpaca";
import { MIN_BUY_USDC } from "./tradeUnits";

dotenv.config();

const abi = new AbiCoder();

export function Events() {
  contract.on("RequestCreated", async (orderId, encryptedOrder) => {
    console.log("📥 Request detected:");
    console.log("orderId", orderId);

    const decoded = abi.decode(["tuple(string cipherText,string iv)"], encryptedOrder);

    const { cipherText, iv } = decoded[0];

    const backend = await getBackendEcdhJwk();

    let decrypted: string | null = null;

    // Preferred path: ECDH against the order's registered ephemeral public key.
    const ephemeralB64 = getEphemeralKey(orderId);
    if (ephemeralB64) {
      try {
        const jwkJson = Buffer.from(ephemeralB64, "base64").toString("utf8");
        const userPublic = await crypto.subtle.importKey(
          "jwk",
          JSON.parse(jwkJson),
          { name: "ECDH", namedCurve: "P-256" },
          true,
          [],
        );
        const shared = await deriveAESKey(backend.privateKey as any, userPublic);
        decrypted = await decrypt(shared, cipherText, iv);
        console.log("🔓 Decrypted via ephemeral ECDH");
      } catch (err) {
        console.warn("Ephemeral-key decrypt failed, trying legacy static keys:", err);
      }
    }

    // Legacy fallback: static env-configured keypair (pre-ephemeral clients).
    if (decrypted === null && process.env.BACKEND_PRIVATE_KEY && process.env.USER_PUBLIC_KEY) {
      const backendPrivate = await importKeyFromEnv(process.env.BACKEND_PRIVATE_KEY, true);
      const userPublic = await importKeyFromEnv(process.env.USER_PUBLIC_KEY, false);
      const sharedB = await deriveAESKey(backendPrivate, userPublic);
      decrypted = await decrypt(sharedB, cipherText, iv);
      console.log("🔓 Decrypted via legacy static keys");
    }

    if (decrypted === null) {
      console.error(`❌ Could not decrypt order ${orderId} — no usable key. Skipping.`);
      return;
    }

    const parsed = JSON.parse(decrypted) as {
      stock: string;
      /** Sell: receipt units to redeem. Buy ignores qty — uses escrowed USDC. */
      qty?: number;
      side: "buy" | "sell";
      orderType?: string;
    };
    const request = await contract.requests(orderId);
    const requester = request[0] as string;

    if (parsed.side === "buy") {
      const escrowUsdc = BigInt(request[1]);
      if (escrowUsdc < MIN_BUY_USDC) throw new Error("Escrow below $1 notional minimum");
      console.log(
        `Decrypted private buy for ${requester}; submitting $${(Number(escrowUsdc) / 1e6).toFixed(2)} notional ${parsed.stock}`,
      );
      const alpacaId = await createBuyOrder(orderId, requester, parsed.stock, escrowUsdc);
      console.log("notional buy submitted with Alpaca id", alpacaId);
      return;
    }

    const receiptUnits = Math.floor(Number(parsed.qty ?? 0));
    if (!Number.isSafeInteger(receiptUnits) || receiptUnits <= 0) {
      throw new Error("Redeem qty must be a positive integer receipt-unit count");
    }
    console.log(
      `Decrypted private redeem for ${requester}; ${receiptUnits} receipt units of ${parsed.stock}`,
    );
    const alpacaId = await createSellOrder(orderId, requester, parsed.stock, receiptUnits);
    console.log("proportional sell submitted with Alpaca id", alpacaId);
  });
}
