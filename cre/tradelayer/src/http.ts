import { cre, httpRequest, json, text, type Runtime, type TeeRuntime } from "@chainlink/cre-sdk";

/**
 * Every outbound call the enclave makes goes through the confidential HTTP capability, so the
 * request — including broker credentials in headers — never leaves the TEE in plaintext and
 * executes exactly once rather than on every DON node.
 *
 * The SDK types the client against `Runtime`, while a confidential handler receives a
 * `TeeRuntime`; both expose `callCapability`, which is all the client uses.
 */
export type AnyRuntime<C> = TeeRuntime<C> | Runtime<C>;

const client = new cre.capabilities.ConfidentialHTTPClient();

export type HttpResult = { status: number; text: string; json: () => unknown };

/**
 * Default timeout, set to the confidential-HTTP capability's ceiling on purpose.
 *
 * The relayer holds each request open until the Hedera transaction has a receipt, which already
 * takes longer than a plain API call. On a free hosting tier the relayer may also be asleep: a
 * cold start costs 30-60s on top. At the old 60s that raced the timeout and a settlement could
 * fail silently — which reads as a broken system rather than a sleeping one. Broker calls, which
 * hit an always-on API, pass a much shorter timeout of their own.
 */
const DEFAULT_TIMEOUT = "90s";

export function request<C>(
  runtime: AnyRuntime<C>,
  opts: {
    url: string;
    method: "GET" | "POST";
    headers?: Record<string, string>;
    body?: object | string;
    timeout?: string;
  },
): HttpResult {
  const resp = client
    .sendRequest(
      runtime as unknown as Runtime<unknown>,
      { request: httpRequest({
        url: opts.url,
        method: opts.method,
        headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
        ...(opts.body !== undefined ? { body: opts.body } : {}),
        timeout: opts.timeout ?? DEFAULT_TIMEOUT,
      }) },
    )
    .result();
  return {
    status: resp.statusCode,
    text: text(resp),
    json: () => json(resp),
  };
}
