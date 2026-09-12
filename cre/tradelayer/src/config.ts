import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
// zod's `.url()` relies on WHATWG URL parsing, which the CRE WASM runtime does not provide —
// it rejects even plainly valid URLs there. A prefix check is all this config needs.
const url = z.string().regex(/^https?:\/\/\S+$/, "must be an http(s) URL");

export const configSchema = z.object({
  reconcileSchedule: z.string(),
  batchSchedule: z.string(),
  hedera: z.object({
    chainId: z.number().int(),
    rpcUrl: url,
    escrow: address,
    ledger: address,
    vault: address,
    registry: address,
    router: address,
    symbols: z.record(z.string(), address),
  }),
  relayerUrl: url,
  /** EVM addresses permitted to pull the HTTP trigger on a *deployed* workflow. The gateway
   * verifies a JWT signed by one of these before the enclave ever runs, so this is what stops a
   * passer-by making the enclave place broker orders. An empty list is valid only in simulation;
   * `cre workflow deploy` rejects it. */
  authorizedKeys: z.array(address),
  /** Real broker only. There is deliberately no mock: a settlement the demo fabricates is not a
   * settlement, and the failure modes that matter (market closed, partial fill, rejection) only
   * appear against the live API. */
  broker: z.object({ baseUrl: url }),
  policy: z.object({
    minExpiryWindowSeconds: z.number().int().positive(),
    maxOpenOrdersPerTick: z.number().int().positive(),
  }),
});

export type Config = z.infer<typeof configSchema>;
