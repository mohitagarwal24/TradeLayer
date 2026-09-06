/**
 * Round-trip verification of the order-privacy wire format.
 * Frontend (viem encodeAbiParameters) -> backend (ethers abi.decode).
 *
 * Run: node packages/nextjs/scripts/verifySealFormat.mjs
 * (needs `yarn install` so viem/ethers are resolvable from the workspace)
 */
import { encodeAbiParameters, decodeAbiParameters } from "viem";
import { AbiCoder } from "ethers";

const cipherText = Buffer.from("roundtrip-ciphertext").toString("base64");
const iv = Buffer.from("0123456789ab").toString("base64");

// --- what the frontend produces (src/lib/sealOrder.ts) ---
const frontendEncoded = encodeAbiParameters(
  [{ type: "tuple", components: [{ name: "cipherText", type: "string" }, { name: "iv", type: "string" }] }],
  [{ cipherText, iv }],
);

// --- what the backend consumes (backend/components/contractListener.ts) ---
const abi = new AbiCoder();
const [decoded] = abi.decode(["tuple(string cipherText,string iv)"], frontendEncoded);

const ok = decoded.cipherText === cipherText && decoded.iv === iv;

// Also verify viem can decode its own encoding symmetrically
const [viemDecoded] = decodeAbiParameters(
  [{ type: "tuple", components: [{ name: "cipherText", type: "string" }, { name: "iv", type: "string" }] }],
  frontendEncoded,
);

console.log("frontend encoded:", frontendEncoded);
console.log("backend ethers decode matches:", ok);
console.log("viem self-decode matches:", viemDecoded.cipherText === cipherText && viemDecoded.iv === iv);

if (!ok) process.exit(1);
