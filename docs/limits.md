# Known limits and roadmap

A privacy claim with an asterisk you have to hunt for is worth nothing. These are the real ones.

## Confidential HTTP cannot reach consensus

**This blocks deployed execution today.** The workflow is deployed and `ACTIVE` on Chainlink's
network, and an HTTP-triggered run that returns before making an outbound call succeeds. Any run
that makes one fails at consensus.

Why: `ConfidentialHTTPResponse` includes `multi_headers` — the full response headers. Real APIs
return `date`, `x-request-id`, `cf-ray` and similar per request, so each DON node hashes different
bytes and no quorum forms. Measured directly: the Hedera RPC response **body** is byte-identical
across calls (166 bytes), the **headers** are not.

The regular HTTP capability solves the equivalent problem with `CacheSettings` — one node calls,
the others reuse. The confidential request type has no such field, and `TeeRuntime` has no
`runInNodeMode`, so the documented aggregation pattern is unreachable from inside a confidential
handler without leaving the TEE.

Chainlink's own documentation says confidential HTTP is *"Single execution: exactly one API call is
made, not one per node"*, which is not the observed behaviour. Reported to Chainlink as beta
feedback.

**Consequence:** the enclave path runs locally through `cre workflow simulate` — the same compiled
WASM, the same handlers, the real chain and the real broker. It is not a mock. But it is not the
DON executing it either, and we say so.

## The escrow leaks order size

Locking an exact amount is visible on-chain even though the symbol is not. A large lock says a
large order. The intended fix is a **pre-funded float** — the vault keeps a standing balance in
escrow and orders draw against it without a per-order lock — which is designed but not built.

## Batching only hides fills at volume

H3 nets fills per symbol across every institution, so unrelated trades cancel. With one
institution and one trade in a window there is nothing to net against.

The guarantee that holds regardless of volume is *hidden until filled*: an order cannot be
front-run, because nothing readable exists before execution.

## TEE trust is hardware, not mathematics

AWS Nitro attestation is a hardware trust assumption. We say **hardware-attested** and
**trust-minimised**, never *trustless*. Confidentiality also covers data, not logic — the workflow
code is public, and should be.

## The relayer is a hot key

One key, no nonce queue. Concurrent settlements collide; this has already shown up with a single
user. It can censor, though it cannot forge or read, and every order has an on-chain
self-executing refund that does not depend on it.

## Optimistic ledger versioning

Two orders racing the same account means one fails `VersionMismatch`. Correct, but it is a
first-write-wins race rather than a queue.

## Operational

- **No rate limiting.** `RELAY_AUTH_TOKEN` protects the endpoint that spends gas; `/orders` is
  open.
- **Order state is ephemeral** on a free Render instance — no persistent disk. The chain is the
  real record.
- **Onboarding needs testnet HBAR and USDC**, with no faucet path in the product. There is also no
  in-app token association: a wallet that cannot auto-associate must do it out of band.
- **Paper broker.** Cash rebalancing between the USDC reserve and the broker is a manual treasury
  step.
- **Sell flow is not built.** Buy side only.

## Divergences from the specification

The Notion architecture is the authoritative design and the code lags it in places. The
deliberate divergences:

| Spec (Notion) | Implementation | Why |
|---|---|---|
| Three per-handler Hedera operator keys | one relayer submitting enclave-signed authorizations | fewer hot keys in the enclave's care; on-chain verification is identical either way |
| H1 writes the policy blob | a dedicated H4 handler | keeps the order path and the policy path separately signed and separately triggered |
| `qty` in the intent | notional only | orders by amount remove the over-reserve and gapped-fill cases entirely |

## Roadmap

Sell flow and share withdrawal through ATS Clearing · dividends as an ATS corporate action ·
custom fee schedule on the equities · `SettlementAttestation` on a CRE-supported chain via
`writeReport` · a slashable operator bond behind the reserve check · the pre-funded float that
closes the order-size leak.
