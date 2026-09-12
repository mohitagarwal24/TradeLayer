# Troubleshooting

Failures that have actually happened, and what they meant.

## Startup

**No `TradeLayer on http://localhost:8000` line.** The port was already taken and the process
never bound. Chain narration still runs, so the terminal looks alive while nothing is served.
`ss -ltnp | grep :8000`, kill the other instance, restart.

**The web app can't reach the service.** Vite moved to 8081 because 8080 was busy. The backend
allows exactly one CORS origin, so everything fails. Free 8080 and restart.

**`enclave signer … verified` never appears.** Advisory only — three attempts with backoff, and
the process keeps running. But if the on-chain signer doesn't match the one this backend signs
as, nothing will ever settle.

## Orders

**The progress card sits on "Opened privately".** The enclave takes 20–30 seconds. It is not a
hang; after 12 seconds the UI says so explicitly.

**`policy: not permitted to buy`.** The employee is not in the institution's published rulebook,
or `canBuy` is false for them. Republish the policy including that wallet.

**No `pre-trade check PASSED` line.** No rulebook was published, so H1 logged `no policy set for
org — default allow` instead. Publish the rules first.

**`VersionMismatch`.** Two writes raced the same account. Optimistic concurrency is doing its job.
Wait and retry once.

**A write silently does nothing.** Almost always a double-click. One relayer key, no nonce queue.

## Chain and RPC

**`chain narration hiccup … 500 Internal Server Error`.** Hashio is a shared public relay and
intermittently 500s. Nothing is lost — the block range is retried on the next tick and no event is
narrated twice. If it is frequent, raise `WATCH_POLL_MS`.

**`wallet lookup failed`.** The same transient RPC flakiness on a read endpoint. The web app shows
an error and may bounce to the landing page; reload.

**Gas estimates run low.** Hashio under-estimates. `RELAY_GAS_LIMIT=4000000` overrides it.

## Hedera specifics

**A transfer to a fresh wallet fails.** The account must be associated with the token. Accounts
created through the Hedera portal come with `max_automatic_token_associations: -1` and associate
on receipt; a bare EVM account may not. Only the account itself can associate — which is why
`forge script` cannot do it for the vault or escrow.

**The scheduled refund never fired.** Traced on testnet to `CONTRACT_REVERT_EXECUTED` — a
one-second boundary between the HIP-1215 schedule firing and the contract's own
`block.timestamp < expiry` check. Fixed by `REFUND_SCHEDULE_BUFFER = 30 seconds`.

**`OrderEscrow` has no HBAR.** The scheduling contract pays for its own HIP-1215 calls. Without a
balance, no self-refund is registered.

## CRE

**`cre workflow simulate` hangs.** No login session. `cre login` or set `CRE_API_KEY`.

**Every relay comes back 401.** `CRE_RELAY_AUTH_TOKEN` in `cre/.env` doesn't match
`RELAY_AUTH_TOKEN` on the backend.

**`owner … not linked; run cre account link-key`** from `cre secrets create`. Misleading. You want
`--secrets-auth browser`; the onchain path files secrets under a wallet address the
private-registry workflow never reads.

**`invalid_request_uri: request_uri not found`.** The single-use auth URI was already spent —
typically by a Linux browser auto-opening it with no Chainlink session — or it expired (about a
minute). Also check nothing still holds `:53682`.

**A deployed execution fails at consensus** with several `HTTPResponse` groups of one. Confidential
HTTP responses carry per-request headers, so nodes never agree. See [Honest limits](../limits.md).

## Resetting

```bash
rm -rf backend/.data      # clears local order history; the chain is unaffected
```

Contracts need no redeploy. A fresh institution needs a fresh admin wallet — `registerOrg` binds
the caller permanently.
