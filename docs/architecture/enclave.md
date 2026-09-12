# The enclave handlers

Four handlers, registered in `cre/tradelayer/main.ts`, all wrapped in `handlerInTee` with the
constraint `[{ tee: "nitro", regions: ["us-west-2"] }]`.

| | Trigger | Inside the enclave |
|---|---|---|
| **H1 intake** | HTTP **0**, `kind: "order"` | opens the sealed intent, verifies the signature, takes the institution from the escrow, decrypts portfolio and rules, places one broker order, signs `LedgerUpdate` |
| **H2 reconcile** | cron, index 1 | polls fills, signs one atomic `Settlement` |
| **H3 batch** | cron, index 2 | nets fills per symbol across **every** institution, signs `AtsMint` / `AtsBurn` |
| **H4 policy** | HTTP **0**, `kind: "policy"` | opens the admin's sealed rulebook, proves authorship against `registry.adminOf`, re-encrypts under `orgKey`, signs `PolicyUpdate` |

## Why H1 and H4 share one trigger

A deployed workflow may register **only one HTTP trigger**. From the Chainlink documentation:

> Each workflow supports only one HTTP trigger handler. There is currently no mechanism to route
> requests to different HTTP trigger handlers within the same workflow.

So `onHttp` is the single entry point and branches on the payload's `kind`. Where `kind` is
absent the shape decides, but only when unambiguous — a body carrying both `orderId` and `orgId`
is refused rather than guessed at, because silently resolving an order as a policy would send it
down the wrong signing path.

`cre workflow simulate` happily runs two HTTP triggers, which is exactly why this only surfaces at
deploy time. The trigger index still matters for simulation, which addresses handlers by number;
the gateway has no such concept and routes purely on the payload.

## Two invariants worth stating

### H1 never trusts `intent.orgId`

The intent is user-supplied and unauthenticated. H1 compares its `orgId` against `order.orgId` —
which `OrderEscrow` resolved from `OrgWalletRegistry` at open time — and rejects a mismatch.

Trusting the intent field would let someone have their order judged against **another
institution's private rules**, which is both a privacy leak and a permission bypass.

### A policy that cannot be decrypted fails closed

If a policy blob exists but this enclave cannot open it — wrong master key, corrupt blob — H1
rejects the order. Rules that cannot be evaluated are never treated as rules that passed.

## Logging and what leaves the enclave

The handlers narrate in the clear: the symbol, the amount, the rule that permitted the order.
That is deliberate and is **not** a leak. `runtime.log` output belongs to the enclave, and CRE
does not surface it outside the TEE in a deployed run:

> user logs for this trigger will not be visible, and will not leave the TEE

Under `cre workflow simulate` it prints locally, on a machine that already holds the keys in
`cre/.env`.

The invariant that matters is one step down: **nothing readable reaches the backend, the relayer
or the chain.** Those see ciphertext, signatures and amounts. The intake API prints the sealed
envelope's structure and states that it holds no key that can open it — because it doesn't.

## Confidential HTTP

Every outbound call goes through `ConfidentialHTTPClient`, so requests — including broker
credentials in headers — execute inside the TEE.

The default timeout is **90 seconds**, the capability's ceiling, set deliberately: the relayer
holds each request open until the Hedera transaction has a receipt, and on a free hosting tier a
cold start adds 30–60 s on top. At the previous 60 s this raced the timeout and a settlement could
fail silently, which reads as a broken system rather than a sleeping one.

> **Known limitation.** Confidential HTTP responses include per-request headers (`date`,
> `x-request-id`, `cf-ray`), so DON consensus cannot form against any real API. This blocks
> deployed execution today and is reported to Chainlink — see [Honest limits](../limits.md).
