import dotenv from "dotenv";

dotenv.config();

const b64url = (buf: ArrayBuffer) => Buffer.from(buf).toString("base64");

/**
 * Backend's static ECDH keypair (P-256) for order-privacy.
 *
 * Generated once per backend install and persisted to BACKEND_ECDH_JWK in
 * .env so restarts don't invalidate pending orders. The public half is served
 * at /public-key; the private half never leaves the process except via env.
 */
export async function getBackendEcdhJwk(): Promise<{ privateKey: CryptoKey; publicKeyJwkB64: string }> {
  if (!process.env.BACKEND_ECDH_JWK) {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveKey",
      "deriveBits",
    ]);
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    console.log(
      "\n=== FIRST RUN ===\nGenerated a new ECDH keypair. Persist it in backend/.env:\nBACKEND_ECDH_JWK=" +
        Buffer.from(JSON.stringify(jwk)).toString("base64") +
        "\n=================\n",
    );
  }

  let jwkJson = process.env.BACKEND_ECDH_JWK;
  if (!jwkJson) {
    // Fall back to an in-memory pair (fine for local dev, lost on restart).
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveKey",
      "deriveBits",
    ]);
    return { privateKey: pair.privateKey, publicKeyJwkB64: await exportPublic(pair) };
  }

  const jwk = JSON.parse(Buffer.from(jwkJson, "base64").toString("utf8"));
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveKey",
    "deriveBits",
  ]);

  // Reconstruct the public JWK from the private one for the /public-key route.
  const { kty, crv, x, y } = jwk;
  const publicJwkB64 = Buffer.from(JSON.stringify({ kty, crv, x, y })).toString("base64");
  return { privateKey, publicKeyJwkB64: publicJwkB64 };
}

async function exportPublic(pair: CryptoKeyPair): Promise<string> {
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return Buffer.from(JSON.stringify(jwk)).toString("base64");
}

export { b64url };
