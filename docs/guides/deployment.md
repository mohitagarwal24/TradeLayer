# Deployment

Three pieces, all on free tiers.

```
Frontend   Vercel          static Vite build
Backend    Render          always-on Node service
Enclave    Chainlink CRE   deployed workflow
```

## 1. The workflow

```bash
cre login
cre secrets create cre/secrets.yaml --secrets-auth browser
cd cre && cre workflow deploy ./tradelayer --target testnet-settings
```

Four things cost time if you don't know them.

**Use the private registry.** `workflow.yaml` sets `deployment-registry: "private"`. Omitting it
defaults to the public onchain registry, which registers on **Ethereum mainnet** and wants real
ETH for every deploy. The private registry is authorised by your CRE login session and needs no
wallet and no gas at all. (The CLI also ships a Sepolia registry address, which sends you to the
wrong faucet — registry writes are mainnet.)

**Secrets need `--secrets-auth browser`.** The default `onchain` mode requires `cre account
link-key` and files secrets under your *wallet* address. A private-registry workflow is owned by
the **org** identity, so those secrets would land in a namespace the workflow never reads. The
error you get points firmly the wrong way.

**The browser auth flow is fragile outside a desktop session.** The `request_uri` is single-use and
expires in about a minute, and the CLI starts a callback server on `:53682`. Under WSL,
`xdg-open` launches a Linux browser with no Chainlink session, which *consumes* the URI — so a
later paste into a logged-in browser fails with `invalid_request_uri: request_uri not found`,
which reads like an outage rather than a spent token. Also check no earlier `cre` process still
holds `:53682`; a stale listener silently swallows the redirect.

**The CLI builds a registry client before reading `deployment-registry`,** so `project.yaml` needs
a read-only `ethereum-mainnet` RPC even though the private path never sends a transaction to it.

### Which gateway

The docs list an `enterprise-gateway` host for private registries. For this workflow it answers
*"workflow not found"*; the public host accepts:

```
https://01.gateway.zone-a.cre.chain.link
```

`backend/scripts/pingGateway.ts` asks both and prints which one answers — worth running rather
than assuming, because the gateway rejects everything identically as `unauthorized`.

## 2. Backend on Render

`render.yaml` is a blueprint: **New → Blueprint**, point it at the repo.

Secrets are marked `sync: false` and set in the dashboard: the five contract addresses,
`ENCLAVE_SIGNER`, `RELAYER_PRIVATE_KEY`, `INTENT_PUBKEY`, `RELAY_AUTH_TOKEN`, the Alpaca data
keys, and `FRONTEND_ORIGIN`.

`RELAY_AUTH_TOKEN` must equal `CRE_RELAY_AUTH_TOKEN` in `cre/.env`, or every enclave write comes
back 401. Smoke test: `curl -X POST …/relay -d '{}'` should return **401**.

**Add a keep-alive.** Free instances sleep after 15 minutes and take 30–60 s to wake. The enclave
calls `/relay` to settle, so a sleeping backend meets a cold start mid-settlement. Point
cron-job.org at `/health` every 10 minutes — 24/7 is ~744 hours against the 750-hour allowance.

Free tier has **no persistent disk**, so `DATA_DIR` is ephemeral. The chain is the real record;
this only affects the envelope and relay-receipt cache.

## 3. Frontend on Vercel

Import the repo, set **Root Directory** to `packages/nextjs`, leave *"Include files outside the
Root Directory"* on — the Yarn 3 release binary and lockfile live at the repo root and the build
fails without them.

No environment variables needed: `vercel.json` supplies the build command, the output directory,
the SPA rewrite (without which a refresh on `/institution` 404s) and `VITE_BACKEND_URL`.

Then set `FRONTEND_ORIGIN` on Render to the Vercel URL and redeploy. The backend allows exactly
one origin; until this matches, every request from the hosted app is rejected.

## Verify

```bash
curl https://<service>.onrender.com/health    # contracts + symbols, chainId 296
curl https://<service>.onrender.com/market    # live prices
curl -X POST https://<service>.onrender.com/relay -d '{}'   # 401 — the token is enforced
```

## What deployment does not give you

A deployed workflow cannot currently complete an order — confidential HTTP consensus fails against
any real API. See [Honest limits](../limits.md). Until that is resolved, the enclave path runs
locally through `cre workflow simulate`, which is the same compiled WASM and the same handlers.
