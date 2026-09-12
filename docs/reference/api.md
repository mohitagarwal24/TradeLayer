# Backend API

Express, port 8000. Exactly one CORS origin is allowed, set by `FRONTEND_ORIGIN`.

Nothing here reveals a balance, a position or a rule — **because this process cannot read them
either.** Institution and employee balances exist only as ciphertext in `ConfidentialLedger`.

## Intake — client-facing

| | | |
|---|---|---|
| `GET` | `/enclave-key` | the public key clients seal intents to, plus chainId and escrow address |
| `POST` | `/orders` | a sealed envelope. Returns `202` immediately; the enclave runs detached |
| `GET` | `/orders/:orderId` | on-chain status plus the trigger history |
| `POST` | `/policy` | a sealed rulebook. **Synchronous** — blocks for the whole enclave run |
| `GET` | `/policy/:orgId` | the current policy version |

`POST /orders` persists the envelope **before** triggering anything: a crash between receipt and
trigger must not strand an order. On restart, every envelope whose escrow is still `OPEN` and
which was never successfully triggered is re-fired.

A second `POST` with the same `orderId` returns `already-received` and does not re-trigger.

## Status — read-only

| | | |
|---|---|---|
| `GET` | `/wallet/:address` | which screen this wallet should see: found, wait, or trade |
| `GET` | `/org/:orgId` | admin, wallet count, rules version, pool totals, open orders |
| `GET` | `/compliance/:address` | per-equity KYC / listed / frozen |
| `GET` | `/market` | tradeable symbols with live prices |
| `GET` | `/market/clock` | `{ isOpen, nextOpen, nextClose }` |
| `GET` | `/health` | contracts, chainId, symbols, relayer address |

`/org/:orgId` returns **platform-wide** pool totals. There is deliberately no per-institution
balance; see [Three ideas](../concepts/three-ideas.md).

> `/market/clock` normalises Alpaca's snake_case. Forwarding the raw payload is what once broke the
> closed-market banner: the UI reads `isOpen`, so `is_open: false` arrived as `undefined` and the
> "queued until the market opens" state never rendered — reading as a stalled order instead.

## Relay — enclave-facing

| | | |
|---|---|---|
| `POST` | `/relay` | an EIP-712 authorization the enclave signed |
| `GET` | `/relay/:digest` | the receipt for a previously relayed authorization |

The relayer verifies the signature **locally** before spending any gas, so a forged payload dies
here rather than at the contract. It dedupes by digest and is idempotent: a retried POST for
something already relayed returns the earlier receipt.

A cached `confirmed` receipt is only trusted after checking `usedDigest` on-chain. The relay store
outlives chain resets, and ATS batch digests are low-entropy — `(symbol, amount, expectedSupply)`
repeats run to run, unlike a settlement carrying a random `orderId` — so a stale receipt would
otherwise silently suppress a real mint and leave the reserve unbacked.

`RELAY_AUTH_TOKEN` guards the endpoint. It is **not** a security boundary — a forged authorization
still dies at the contract's signature check — it just stops a passer-by burning the relayer's gas.

## Chain narration

Not an endpoint, but the most useful thing the backend does: it polls Hedera and narrates every
event in the terminal, tagged and timestamped. It watches 5 contracts and 13 events with one
`getLogs` per contract per tick, collecting everything before printing so a partial RPC failure
never narrates an event twice.

This log is also an honest demonstration of how little is public: an amount, a deadline, and
ciphertext version numbers.
