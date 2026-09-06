import { encodeAbiParameters } from "viem";

/**
 * Client side of TradeLayer's order-privacy scheme.
 *
 * Order intents (stock, qty, side) are encrypted with AES-GCM under a key
 * derived via ECDH (P-256) between the backend's static keypair and the
 * user's ephemeral keypair. Only an ephemeral public key rides on-chain with
 * the ciphertext, so observers cannot read or correlate orders.
 *
 * Wire format mirrors backend/decrypt.ts exactly: base64 JWKs, AES-GCM 256,
 * random 12-byte IV, fields packed as abi.encode((string cipherText,string iv)).
 */

const CURVE = "P-256";

export type SealedOrder = {
  /** abi.encode of tuple(cipherText, iv) — emitted on-chain in RequestCreated */
  encryptedOrder: `0x${string}`;
  /** User's ephemeral public JWK (base64url of JSON), delivered to the backend off-chain. */
  ephemeralPublicKeyB64: string;
};

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function generateOrderKeypair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "ECDH", namedCurve: CURVE }, true, ["deriveKey"]);
}

/** Export the ephemeral public key as base64(JSON JWK) for delivery to the backend. */
export async function exportPublicKeyB64(keypair: CryptoKeyPair): Promise<string> {
  const jwk = await crypto.subtle.exportKey("jwk", keypair.publicKey);
  return toBase64(new TextEncoder().encode(JSON.stringify(jwk)));
}

/** Import the backend's static public JWK (base64 of JSON) fetched from its API. */
async function importBackendPublicKey(publicKeyJwkB64: string): Promise<CryptoKey> {
  const jwkJson = new TextDecoder().decode(Uint8Array.from(atob(publicKeyJwkB64), (c) => c.charCodeAt(0)));
  return crypto.subtle.importKey("jwk", JSON.parse(jwkJson), { name: "ECDH", namedCurve: CURVE }, true, []);
}

/**
 * Seal an order intent against the backend's static public key.
 * @param backendPublicKeyB64 base64(JSON JWK) from the backend /api/public-key endpoint
 */
export async function sealOrder(
  intent: { stock: string; qty: number; side: "buy" | "sell"; orderType?: string },
  backendPublicKeyB64: string,
): Promise<SealedOrder> {
  const keypair = await generateOrderKeypair();
  const backendPublic = await importBackendPublicKey(backendPublicKeyB64);

  const aesKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: backendPublic },
    keypair.privateKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(intent));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plaintext);

  // Matches backend: abi.decode(encryptedOrder, ["tuple(string cipherText,string iv)"])
  const encryptedOrder = encodeAbiParameters(
    [{ type: "tuple", components: [{ name: "cipherText", type: "string" }, { name: "iv", type: "string" }] }],
    [{ cipherText: toBase64(ciphertext), iv: toBase64(iv) }],
  );

  return { encryptedOrder, ephemeralPublicKeyB64: await exportPublicKeyB64(keypair) };
}
