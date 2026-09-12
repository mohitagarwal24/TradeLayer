# Running it locally

Hedera testnet only. There is no local chain and no mock broker — the states that matter (queued
outside market hours, partial fills, rejections) only exist against the real chain and the real
broker.

## Prerequisites

| | |
|---|---|
| Node | 20 (via nvm) |
| bun | for the CRE workflow |
| Foundry | `forge`, `cast` |
| `cre` CLI | logged in (`cre login`) or `CRE_API_KEY` set |
| MetaMask | on **Hedera Testnet (chain 296)** |

On WSL none of these are on a non-interactive PATH:

```bash
export PATH="$HOME/.foundry/bin:$HOME/.bun/bin:$HOME/.cre/bin:$PATH"
source "$HOME/.nvm/nvm.sh" && nvm use 20
```

## Install

```bash
yarn install
(cd backend && npm install)
(cd cre/tradelayer && bun install)
```

## Environment files

All gitignored; each has a `.env.example`.

| File | Holds |
|---|---|
| `packages/foundry/.env` | `PRIVATE_KEY`, `ENCLAVE_SIGNER`, the three ATS addresses |
| `backend/.env` | contract addresses, `RELAYER_PRIVATE_KEY`, `INTENT_PUBKEY`, Alpaca data keys |
| `cre/.env` | the six workflow secrets the simulator reads |
| `packages/ats/.env` | ATS issuance and role wiring |

## Run

```bash
cd backend && npm start     # intake + relayer + chain narration on :8000
yarn start                  # the web app on :8080
```

Wait for these three lines before opening the browser:

```
intake   TradeLayer on http://localhost:8000
enclave  signer 0x…  verified on escrow, ledger and vault
chain    watching 5 contracts from block …
```

> **If the first line is missing, the port was already taken.** Chain narration still runs, so the
> terminal looks alive while nothing is actually being served. Check with `ss -ltnp | grep :8000`.

The web app **must** be on 8080 — Vite silently moves to 8081 if the port is busy, and the backend
allows exactly one CORS origin, so every request then fails.

## Headless clients

Useful without a browser:

```bash
cd cre/tradelayer && ADMIN_KEY=… EMPLOYEE_1=0x… bun scripts/setPolicy.ts
cd cre/tradelayer && EMPLOYEE_KEY=… bun scripts/placeOrder.ts TSLA 5
cd cre/tradelayer && EMPLOYEE_KEY=… bun scripts/status.ts
```

`status.ts` prints the public view and then the decrypted private view side by side, which is the
clearest demonstration of what is and isn't visible.

## Settling a fill

H2 is a cron handler and does not self-fire locally. Run it by hand:

```bash
cd cre && cre workflow simulate ./tradelayer --target testnet-settings \
  --trigger-index 1 --non-interactive --allow-insecure-rpc
```

Outside US market hours the broker holds the order as `accepted` and H2 reports
`pending:accepted`. **That is a real, expected state, not a failure.**

## Checks

Nothing runs them all.

```bash
cd packages/foundry && forge test                       # 87
forge build --sizes                                     # all well under 24576 B
cd cre/tradelayer && bun test && bunx tsc --noEmit       # 13 crypto vectors
cd cre && cre workflow build ./tradelayer --target testnet-settings --non-interactive
cd backend && npx tsc --noEmit
cd backend && npx tsx scripts/checkGatewayJwt.ts        # 15 JWT wire-format checks
yarn frontend:check-types && yarn frontend:lint && yarn frontend:build
```

## Timing to expect

Each sealed action spends **20–30 seconds** in the enclave — CLI compile plus enclave start-up
dominate. That is normal, not a hang.

## One-time setup, if redeploying

```bash
yarn deploy:hedera-testnet     # needs PRIVATE_KEY, ENCLAVE_SIGNER, ATS_* in packages/foundry/.env
yarn ats:setup-hedera          # associate vault + escrow + operator with USDC
yarn ats:grant-router-roles    # AGENT → vault; KYC/CONTROL_LIST/FREEZE_MANAGER → router
```

`OmnibusVault` and `OrderEscrow` must each associate with USDC after deployment. Only the account
itself may associate, so `forge script` cannot do it — it simulates in an environment where the
HTS system contract at `0x167` does not exist.
