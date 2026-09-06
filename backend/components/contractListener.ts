import { contract } from "./contract";
import dotenv from "dotenv";
import { importKeyFromEnv, deriveAESKey, decrypt } from "../decrypt";
import { getBackendEcdhJwk } from "./backendKeys";
import { getEphemeralKey } from "./keyExchange";
import { AbiCoder } from "ethers";
import { createOrder } from "./alpaca";

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

    const parsed = JSON.parse(decrypted);
    console.log("Decrypted order:", parsed);

    const order = await createOrder(orderId, parsed.stock, parsed.qty, parsed.side, parsed.orderType ?? "market");
    console.log("order executed with order id", order);
  });
}
