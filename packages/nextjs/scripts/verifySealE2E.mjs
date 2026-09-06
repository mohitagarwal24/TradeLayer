/**
 * True end-to-end verification of order privacy:
 *   frontend sealOrder (WebCrypto ECDH+AES-GCM, viem ABI)
 *     -> backend contractListener decrypt path (WebCrypto ECDH+AES-GCM, ethers ABI)
 *
 * Run: node packages/nextjs/scripts/verifySealE2E.mjs
 */
import { encodeAbiParameters } from "viem";
import { AbiCoder } from "ethers";

// ---- shared crypto helpers (mirror both sides) ---------------------------
const b64 = (buf) => Buffer.from(buf).toString("base64");
const unb64 = (s) => Uint8Array.from(Buffer.from(s, "base64"));
const subtle = globalThis.crypto.subtle;

async function generateKeypair() {
  return subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
}

async function jwkExport(key) {
  return subtle.exportKey("jwk", key);
}

async function importPublic(jwk) {
  return subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, []);
}

// ---- frontend side (mirrors src/lib/sealOrder.ts) -------------------------
async function frontendSeal(intent, backendPublicJwk) {
  const keypair = await generateKeypair();
  const backendPublic = await importPublic(backendPublicJwk);

  const aesKey = await subtle.deriveKey(
    { name: "ECDH", public: backendPublic },
    keypair.privateKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(intent));
  const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plaintext);

  const encryptedOrder = encodeAbiParameters(
    [{ type: "tuple", components: [{ name: "cipherText", type: "string" }, { name: "iv", type: "string" }] }],
    [{ cipherText: b64(ciphertext), iv: b64(iv) }],
  );

  // ephemeral public key delivered off-chain to the backend
  const ephemJwk = await jwkExport(keypair.publicKey);
  return { encryptedOrder, ephemeralJwk: ephemJwk };
}

// ---- backend side (mirrors backend/decrypt.ts derive + decrypt) -----------
async function backendDecrypt(encoded, ephemeralJwk, backendPrivateJwk) {
  const abiCoder = new AbiCoder();
  const [tuple] = abiCoder.decode(["tuple(string cipherText,string iv)"], encoded);
  const { cipherText, iv } = tuple;

  const backendPriv = await subtle.importKey("jwk", backendPrivateJwk, { name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveKey",
    "deriveBits",
  ]);
  const userPub = await importPublic(ephemeralJwk);

  const shared = await subtle.deriveKey(
    { name: "ECDH", public: userPub },
    backendPriv,
    { name: "AES-GCM", length: 256 },
    true,
    ["decrypt"],
  );

  const plainBuf = await subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, shared, unb64(cipherText));
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

// ---- run the round trip ----------------------------------------------------
const intent = { stock: "AAPL", qty: 100, side: "buy", orderType: "market" };

// Backend's static keypair (as generated on first run and stored in env)
const backendPair = await generateKeypair();
const backendPrivJwk = await jwkExport(backendPair.privateKey);
// /public-key serves only the public half
const backendPubJwk = (({ kty, crv, x, y }) => ({ kty, crv, x, y }))(await jwkExport(backendPair.publicKey));

const { encryptedOrder, ephemeralJwk } = await frontendSeal(intent, backendPubJwk);
console.log("sealed on-chain payload:", encryptedOrder.slice(0, 60), "...");

const recovered = await backendDecrypt(encryptedOrder, ephemeralJwk, backendPrivJwk);

console.log("original:", intent);
console.log("backend recovered:", recovered);

const match =
  recovered.stock === intent.stock &&
  recovered.qty === intent.qty &&
  recovered.side === intent.side &&
  recovered.orderType === intent.orderType;

console.log(match ? "\nE2E SEAL/UNSEAL: PASS" : "\nE2E SEAL/UNSEAL: FAIL");

// Sanity: wrong key must NOT decrypt
try {
  const strangerPair = await generateKeypair();
  const strangerJwk = await jwkExport(strangerPair.privateKey);
  await backendDecrypt(encryptedOrder, ephemeralJwk, strangerJwk);
  console.log("wrong-key decryption unexpectedly succeeded: FAIL");
  process.exit(1);
} catch {
  console.log("wrong-key correctly rejected: PASS");
}

if (!match) process.exit(1);
