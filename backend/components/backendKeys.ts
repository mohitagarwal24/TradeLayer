import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv.config();

const b64url = (buf: ArrayBuffer) => Buffer.from(buf).toString("base64");

type CachedPair = { privateKey: CryptoKey; publicKeyJwkB64: string };
let cached: CachedPair | null = null;

function persistJwk(jwkB64: string) {
  const envPath = path.resolve(process.cwd(), ".env");
  try {
    let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
    if (/^BACKEND_ECDH_JWK=/m.test(text)) {
      text = text.replace(/^BACKEND_ECDH_JWK=.*$/m, `BACKEND_ECDH_JWK=${jwkB64}`);
    } else {
      text += `\nBACKEND_ECDH_JWK=${jwkB64}\n`;
    }
    fs.writeFileSync(envPath, text);
    process.env.BACKEND_ECDH_JWK = jwkB64;
    console.log("Persisted BACKEND_ECDH_JWK to .env");
  } catch (error) {
    console.warn("Could not persist BACKEND_ECDH_JWK:", (error as Error).message);
  }
}

/**
 * Backend's static ECDH keypair (P-256) for order-privacy.
 * Cached in-process and auto-persisted to BACKEND_ECDH_JWK so restarts and
 * concurrent requests share one key.
 */
export async function getBackendEcdhJwk(): Promise<CachedPair> {
  if (cached) return cached;

  const existing = process.env.BACKEND_ECDH_JWK?.trim();
  if (existing) {
    const jwk = JSON.parse(Buffer.from(existing, "base64").toString("utf8"));
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"],
    );
    const { kty, crv, x, y } = jwk;
    cached = {
      privateKey,
      publicKeyJwkB64: Buffer.from(JSON.stringify({ kty, crv, x, y })).toString("base64"),
    };
    return cached;
  }

  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveKey",
    "deriveBits",
  ]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const jwkB64 = Buffer.from(JSON.stringify(jwk)).toString("base64");
  persistJwk(jwkB64);

  cached = {
    privateKey: pair.privateKey,
    publicKeyJwkB64: await exportPublic(pair),
  };
  return cached;
}

async function exportPublic(pair: CryptoKeyPair): Promise<string> {
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return Buffer.from(JSON.stringify(jwk)).toString("base64");
}

export { b64url };
