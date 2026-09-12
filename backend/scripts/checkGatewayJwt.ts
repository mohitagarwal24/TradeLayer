import { createHash } from "node:crypto";
import { Wallet, verifyMessage } from "ethers";
import { buildJwt, buildRequest, canonicalJson } from "../src/creGateway";

/**
 * Pins the CRE gateway's JWT contract.
 *
 * Every detail here fails the same opaque way in production — the gateway answers "unauthorized"
 * whether the recovery byte is wrong, the digest was taken over differently-ordered JSON, or the
 * claims are malformed. Checking it locally is the difference between a one-line fix and an
 * afternoon guessing.
 *
 *   npx tsx scripts/checkGatewayJwt.ts
 */

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log("  \x1b[32mPASS\x1b[0m", name);
  } else {
    fail++;
    console.log("  \x1b[31mFAIL\x1b[0m", name, extra);
  }
};

async function main() {
  console.log("canonical JSON — the gateway rehashes the body it receives");
  ok("sorts keys at every level", canonicalJson({ b: 1, a: { d: 2, c: 3 } }) === '{"a":{"c":3,"d":2},"b":1}');
  ok("preserves array order", canonicalJson({ x: [3, 1, 2] }) === '{"x":[3,1,2]}');
  ok("drops undefined properties", canonicalJson({ a: undefined, b: 1 }) === '{"b":1}');
  ok("input key order cannot change the output", canonicalJson({ jsonrpc: "2.0", id: "x" }) === canonicalJson({ id: "x", jsonrpc: "2.0" }));

  console.log("JSON-RPC envelope");
  const req = buildRequest({ kind: "order", orderId: "0xabc" }, "a".repeat(64));
  ok("method is workflows.execute", req.method === "workflows.execute");
  ok("workflowID is 64 hex, unprefixed", /^[0-9a-f]{64}$/.test(req.params.workflow.workflowID));

  console.log("JWT");
  // Anvil account #1. A well-known throwaway; nothing is signed with it outside this check.
  const wallet = new Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const jwt = await buildJwt(req, wallet);
  const [h, c, sigB64] = jwt.split(".");
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
  const claims = JSON.parse(Buffer.from(c, "base64url").toString("utf8"));

  ok("header is alg ETH / typ JWT", header.alg === "ETH" && header.typ === "JWT", JSON.stringify(header));
  ok("iss is the signer's address", claims.iss === wallet.address, claims.iss);
  ok("exp is iat + 300 — the gateway caps it at five minutes", claims.exp - claims.iat === 300);
  ok("jti is a uuid, for replay protection", /^[0-9a-f-]{36}$/.test(claims.jti));
  ok(
    "digest is sha256 over the canonical body",
    claims.digest === `0x${createHash("sha256").update(canonicalJson(req), "utf8").digest("hex")}`,
  );

  const sig = Buffer.from(sigB64, "base64url");
  ok("signature is 65 bytes", sig.length === 65, String(sig.length));
  // The one most likely to be wrong: ethers signs with v = 27/28, the gateway wants 0/1.
  ok("recovery byte is 0 or 1, not 27/28", sig[64] === 0 || sig[64] === 1, String(sig[64]));

  const restored = Buffer.from(sig);
  restored[64] += 27;
  ok(
    "the gateway would recover the authorized address",
    verifyMessage(`${h}.${c}`, `0x${restored.toString("hex")}`) === wallet.address,
  );

  const tampered = { ...req, params: { ...req.params, input: { kind: "order", orderId: "0xdef" } } };
  ok(
    "a tampered body no longer matches the signed digest",
    claims.digest !== `0x${createHash("sha256").update(canonicalJson(tampered), "utf8").digest("hex")}`,
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

void main();
