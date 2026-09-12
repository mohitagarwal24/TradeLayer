import { createHash, randomUUID } from "node:crypto";
import { getBytes, Wallet } from "ethers";
import { config } from "./config";
import { log, short } from "./log";

/**
 * Client for a *deployed* CRE workflow's HTTP trigger.
 *
 * Simulation spawns the CLI locally; a deployed workflow is reached by POSTing a JSON-RPC request
 * to Chainlink's gateway, authenticated by a JWT the workflow's `authorizedKeys` list accepts.
 * The gateway verifies the signature before the enclave runs, which is what stops a passer-by
 * making the enclave place broker orders.
 *
 * Spec: https://docs.chain.link/cre/guides/workflow/using-triggers/http-trigger/triggering-deployed-workflows
 */

/**
 * JSON with object keys sorted at every level.
 *
 * The gateway recomputes the digest from the body it receives and compares it to the one inside
 * the JWT, so both sides must serialise identically — "Incorrect ordering will cause signature
 * verification to fail". Upstream uses `json-stable-stringify`; this is the same contract without
 * the dependency: objects sorted, array order preserved, `undefined` properties dropped.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .filter(k => obj[k] !== undefined)
    .map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",");
  return `{${body}}`;
}

const b64url = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");

export type JsonRpcRequest = {
  id: string;
  jsonrpc: "2.0";
  method: "workflows.execute";
  params: { input: unknown; workflow: { workflowID: string } };
};

export function buildRequest(input: unknown, workflowId: string): JsonRpcRequest {
  return {
    id: randomUUID(),
    jsonrpc: "2.0",
    method: "workflows.execute",
    params: { input, workflow: { workflowID: workflowId } },
  };
}

/**
 * `alg: "ETH"` — not a registered JWS algorithm. The signing input is signed as an EIP-191
 * personal message (keccak over the "\x19Ethereum Signed Message:\n" prefix), and the 65-byte
 * r‖s‖v is base64url-encoded as the signature segment.
 */
export async function buildJwt(request: JsonRpcRequest, wallet: Wallet): Promise<string> {
  const digest = `0x${createHash("sha256").update(canonicalJson(request), "utf8").digest("hex")}`;
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: "ETH", typ: "JWT" }), "utf8"));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        digest,
        iss: wallet.address,
        iat,
        // The gateway caps this at five minutes past `iat`.
        exp: iat + 300,
        jti: randomUUID(),
      }),
      "utf8",
    ),
  );

  const signingInput = `${header}.${claims}`;
  const sig = getBytes(await wallet.signMessage(signingInput));
  // ethers returns v as 27/28; the gateway wants the raw recovery id. Upstream normalises the
  // same way (`v >= 27n ? v - 27n : v`). Getting this wrong fails as "unauthorized", not as a
  // malformed token, so it is worth being explicit.
  if (sig.length !== 65) throw new Error(`unexpected signature length ${sig.length}`);
  const normalised = Uint8Array.from(sig);
  if (normalised[64] >= 27) normalised[64] -= 27;

  return `${signingInput}.${b64url(normalised)}`;
}

export type GatewayResult = { ok: boolean; note: string; executionId?: string };

/** POST one trigger payload to the deployed workflow. */
export async function execute(input: unknown, label: string): Promise<GatewayResult> {
  const { gatewayUrl, workflowId, gatewaySigningKey } = config.trigger;
  if (!gatewayUrl) return { ok: false, note: "CRE_GATEWAY_URL not set" };
  if (!workflowId) return { ok: false, note: "CRE_WORKFLOW_ID not set" };
  if (!/^[0-9a-fA-F]{64}$/.test(workflowId)) return { ok: false, note: "CRE_WORKFLOW_ID must be 64 hex characters" };
  if (!gatewaySigningKey) return { ok: false, note: "no GATEWAY_SIGNING_KEY or RELAYER_PRIVATE_KEY" };

  const wallet = new Wallet(gatewaySigningKey);
  const request = buildRequest(input, workflowId);
  const jwt = await buildJwt(request, wallet);
  // Send the exact bytes the digest was taken over, so serialisation can never drift.
  const body = canonicalJson(request);

  log("enclave", `handing ${label} to the deployed workflow`, { signer: short(wallet.address, 12) });

  let res: Response;
  try {
    res = await fetch(gatewayUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    return { ok: false, note: `gateway unreachable: ${(error as Error).message}` };
  }

  const text = await res.text();
  let parsed: { result?: { workflow_execution_id?: string; status?: string }; error?: { message?: string } } | undefined;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, note: `gateway HTTP ${res.status}: ${text.slice(0, 300)}` };
  }

  if (parsed?.error) return { ok: false, note: `gateway error: ${parsed.error.message ?? JSON.stringify(parsed.error)}` };
  if (!res.ok) return { ok: false, note: `gateway HTTP ${res.status}: ${text.slice(0, 300)}` };

  const executionId = parsed?.result?.workflow_execution_id;
  const status = parsed?.result?.status ?? "unknown";
  log("enclave", `${label} accepted by the DON — ${status}`, { execution: executionId ? short(executionId, 14) : undefined });
  return { ok: status === "ACCEPTED", note: `${status}${executionId ? ` ${executionId}` : ""}`, executionId };
}
