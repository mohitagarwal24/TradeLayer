# Deploying TradeLayer

Target: a hosted app a judge can open, on free tiers, with no card.

```
Frontend   Vercel                 static Vite build           free
Backend    Render                 always-on Node service      free
Enclave    Chainlink CRE          deployed workflow           free
```

---

## The one thing that has to happen first

The backend currently reaches the enclave by shelling out to `cre workflow simulate`. That needs
the CRE CLI, bun and an authenticated login — none of which exist on a hosting platform. **Until
the workflow is deployed to CRE, a hosted backend cannot process an order.**

So the order is: deploy the workflow → host the backend → host the frontend. `TRIGGER_MODE` keeps
the local `simulate` path working the whole time, so nothing you can demo today is at risk.

---

## 1. Deploy the workflow to CRE

```bash
cre account link-key                  # once, if no owner is linked
cre secrets create cre/secrets.yaml   # uploads to the Vault DON
cd cre && cre workflow deploy ./tradelayer
```

These prerequisites are done; this records what they were.

- **`authorizedKeys`.** An empty list is valid only in simulation — a deployed workflow rejects an
  unauthorised HTTP trigger. `config.testnet.json` now lists the backend's address
  (`0xC350…55AD`), and `backend/src/creGateway.ts` signs each request with the matching key. The
  key defaults to `RELAYER_PRIVATE_KEY`, so no new secret is needed; set `GATEWAY_SIGNING_KEY` if
  you would rather the trigger identity could not also spend gas.
- **One HTTP trigger, not two.** We registered two (H1 intake, H4 policy). A deployed workflow
  supports only one — "there is currently no mechanism to route requests to different HTTP trigger
  handlers within the same workflow" — so they now share trigger 0 and `onHttp` branches on the
  payload's `kind`, which is the documented pattern. Simulation runs two happily, so this was
  invisible until deployment.
- **`relayerUrl` must be publicly reachable.** A DON-hosted enclave cannot POST to `localhost`.
  Done — `config.testnet.json` points at the Render service. Note this also means a local
  `cre workflow simulate` now relays through the hosted backend, so the hosted relayer key is the
  one that spends the gas.

`cre secrets create` reads `cre/secrets.yaml`, which maps `RELAY_AUTH_TOKEN` to
`CRE_RELAY_AUTH_TOKEN` in `cre/.env`. That value must equal `RELAY_AUTH_TOKEN` on Render or every
relay call comes back 401.

Keep the workflow id it prints — the backend needs it as `CRE_WORKFLOW_ID`.

## 2. Backend on Render

**Already live:** <https://tradelayer-backend.onrender.com>. The rest of this section is how it
got there, and what to redo if the service is recreated.

`render.yaml` is a blueprint: **New → Blueprint**, point it at the repo, and Render reads it.

Set the secret values in the dashboard (they are marked `sync: false` so they never enter git):

| | |
|---|---|
| `ORDER_ESCROW` `CONFIDENTIAL_LEDGER` `OMNIBUS_VAULT` `ORG_WALLET_REGISTRY` `COMPLIANCE_ROUTER` | from the deploy output |
| `ENCLAVE_SIGNER` | address of the enclave signing key |
| `RELAYER_PRIVATE_KEY` | funded with HBAR; this key pays for every settlement |
| `INTENT_PUBKEY` | compressed pubkey clients seal to |
| `RELAY_AUTH_TOKEN` | any long random string; must equal `CRE_RELAY_AUTH_TOKEN` |
| `CRE_GATEWAY_URL` `CRE_WORKFLOW_ID` | from step 1 |
| `ALPACA_DATA_KEY_ID` `ALPACA_DATA_SECRET` | read-only quotes for the UI |
| `FRONTEND_ORIGIN` | the Vercel URL — CORS rejects anything else |

**Then add a keep-alive.** Free instances sleep after 15 minutes and take 30–60s to wake. The
enclave calls `/relay` to settle, so a sleeping backend meets a cold start mid-settlement. Point
[cron-job.org](https://cron-job.org) at `https://tradelayer-backend.onrender.com/health` every 10
minutes. Running 24/7 is ~744 hours a month against the 750-hour allowance — one service fits.

Two free-tier limits worth knowing: **no persistent disk**, so `DATA_DIR` is ephemeral and the
envelope cache resets on redeploy (the chain is the real record); and **512 MB RAM**, which this
service fits comfortably.

## 3. Frontend on Vercel

Import the repo, set **Root Directory** to `packages/nextjs`. `vercel.json` supplies the rest,
including the rewrite that makes `/institution`, `/trade` and `/positions` work — without it a
refresh on any of them 404s.

`VITE_BACKEND_URL` is already baked into `vercel.json` as `build.env`, so there is nothing to set
in the dashboard — the repo alone builds against the live backend. Override it in project settings
only if the backend URL changes.

Then set `FRONTEND_ORIGIN` on Render to the Vercel URL and redeploy the backend. **The app will not
work until you do** — it is `http://localhost:8080` today, and CORS rejects every other origin.

## 4. Check it

```bash
curl https://tradelayer-backend.onrender.com/health   # contracts + symbols, chainId 296
curl https://tradelayer-backend.onrender.com/market   # live prices from Alpaca
curl -X POST https://tradelayer-backend.onrender.com/relay -d '{}'   # 401 — the token is enforced
```

All three verified green on 2026-09-12.

Open the Vercel URL, connect a wallet on Hedera testnet, and walk the flow in
[DEMO.md](DEMO.md).

---

## What this is not

Deployed, a judge can use it. It is **not** ready for untrusted users at scale, and the gaps are
known rather than hidden:

- **The relayer has one hot key and no nonce queue.** Concurrent settlements will collide; this
  already showed up once with a single user.
- **`ConfidentialLedger` uses optimistic versions.** Two orders racing on the same account will
  have one fail `VersionMismatch`.
- **No rate limiting.** `RELAY_AUTH_TOKEN` protects the endpoint that spends gas; `/orders` is
  still open.
- **Order state is ephemeral** on a free instance.
- **Onboarding needs testnet HBAR and USDC**, with no faucet path in the product.

The first three are roughly a day's work. The last is a product decision.
