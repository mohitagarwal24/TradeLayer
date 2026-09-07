# TradeLayer Protocol

Escrow USDC on Hedera, submit an **encrypted** equity intent, execute at Alpaca (paper), and settle an **ATS** receipt token (`DSTOCK`) on-chain.

Built for **ETHOnline 2026** Hedera tracks (tokenization + agentic payments). **Testnet / Anvil only — no mainnet.**

- **Demo:** [YouTube](https://www.youtube.com/watch?v=KfeFqoLg0nE&feature=youtu.be)
- **Deck:** [Canva](https://www.canva.com/design/DAG6qVimow0/y0wbJBTPGFYrGahnf-PRSQ/edit)

> Local learning/run notes (not in git): `docs/local/LEARNING.md` and `docs/local/USAGE.md` on your machine after generating them.

---

## Status and security notice

1. **Do not use the old Base mainnet address** `0x5c7B3c7AC4640d5eB9424e93F10F9ab299516333` — an earlier build lacked `onlyBackend` on settlement.
2. **Alpaca keys once appeared in git history** — treat them as burned; use env vars only.
3. This is a **hackathon prototype**, not production custody software.

---

## Exact-notional model (current)

- User spends exact USDC (whole cents, **min $1**).
- Alpaca receives a **notional** market buy (`time_in_force: day`). Share quantity is an execution result.
- **1 DSTOCK unit = $0.01** of deposited value (`setNominalValue(1, 2)` on ATS).
- Per-asset fractional shares + receipt units live in the backend **private ledger**.
- Redeem burns receipt units for one asset, sells **proportional** private shares, pays **actual** USDC proceeds.
- Demo universe: **TSLA / VOO / QQQ** (Pyth-entitled feeds).

```
User 5.00 USDC → escrow → Alpaca $5 notional → mint ~500 DSTOCK
Redeem 200 units → sell ~40% of private shares → burn 200 → pay fill proceeds
```

---

## What is implemented

| Area | Status |
|---|---|
| `TradeLayer.sol` escrow + cent-NAV mint/burn | Done |
| ATS DSTOCK (ERC-3643 path) mint/burn/freeze/KYC/whitelist | Done (Hedera testnet) |
| Encrypted orders (ECDH P-256 + AES-GCM) | Done |
| Exact-notional Alpaca buys + proportional sells | Done |
| Restart-safe fill reconciliation | Done |
| Private portfolio API (wallet-signed) | Done |
| Vite UI buy/redeem/portfolio | Done |
| x402 / Blocky402 paid APIs + optional HCS audit | Done |
| Foundry unit + invariant tests | Done |

### On-chain (`TradeLayer.sol`)

| Function | Behaviour |
|---|---|
| `buyStock(orderId, encryptedOrder, amountOfUsdc)` | Escrows whole-cent USDC (≥ $1), emits `RequestCreated`. |
| `redeemStock(orderId, encryptedOrder, amount)` | Freezes ATS units, locks redeem balance. |
| `fulfillRequest(orderId, result)` | **`onlyBackend`**. Mints/burns `dstockUnits`, refunds or pays USDC. |
| `cancelRequest(orderId)` | **`onlyBackend`**. Restores escrow or unfreezes units. |
| `getStockPrice` / `getStockPriceUnsafe` | Pyth equity feeds (TSLA/VOO/QQQ). |

### Off-chain (`backend/`)

- `/public-key`, `/ephemeral-key` — order privacy
- `/prices` — authenticated Hermes proxy
- `/private-portfolio/:address` — signed reveal of private positions
- `/order-status/:id`, `/portfolio/:addr` — x402-gated
- Alpaca websocket + periodic reconciliation for missed fills

### Frontend (`packages/nextjs/`)

Scaffold-ETH 2 hooks only (`useScaffoldReadContract` / `useScaffoldWriteContract`). Exact USDC buy, receipt-value redeem, private portfolio reveal.

---

## Repository layout

```
packages/foundry/     TradeLayer, mocks, Foundry tests, Deploy.s.sol
packages/nextjs/      Vite + React dApp
packages/ats/         ATS issue / configure / lifecycle scripts
backend/              Settlement, Alpaca, Pyth, x402
docs/local/           Personal learning + usage notes (gitignored)
```

---

## Setup

Requires Node ≥ 20, Yarn 3, [Foundry](https://book.getfoundry.sh/getting-started/installation).

```bash
yarn install
cp backend/.env.example backend/.env
# Fill Alpaca, Hedera private_key, contract, PYTH_API_KEY, x402 fields
```

| Variable | Purpose |
|---|---|
| `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`, `ALPACA_PAPER` | Broker (paper by default) |
| `contract`, `private_key` | TradeLayer address + settle wallet |
| `PYTH_API_KEY` | Authenticated Hermes |
| `BACKEND_ECDH_JWK` | Persisted order-privacy key (auto-written on first run) |
| `X402_PAY_TO`, `HEDERA_*`, `HCS_AUDIT_TOPIC` | Agentic payments + audit |
| `VITE_BACKEND_URL` | Frontend → backend (default `http://localhost:8000`) |

### Local Anvil

```bash
yarn chain          # terminal 1
yarn deploy         # terminal 2
yarn start          # terminal 3 — http://localhost:8080
cd backend && npx tsx index.ts   # terminal 4
```

### Hedera testnet

```bash
# packages/foundry/.env: PRIVATE_KEY + ATS_DSTOCK
yarn deploy:hedera-testnet
cd packages/ats && yarn configure-tradelayer   # agent role, $0.01 nominal, whitelist
# update backend/.env contract=...
# fund TradeLayer with a small USDC reserve for profitable redeems
cd backend && npx tsx index.ts
yarn start
```

Proof scripts (market hours for fills):

```bash
cd backend
npx tsx scripts/notionalBuyProof.ts
RECEIPT_UNITS=200 SYMBOL=TSLA npx tsx scripts/notionalRedeemProof.ts
npx tsx scripts/x402Agent.ts
```

---

## Tests

```bash
cd packages/foundry && forge test
cd packages/nextjs && yarn check-types && yarn lint && yarn build
cd backend && npx tsc --noEmit && npx tsx scripts/checkNotionalMath.ts
cd packages/ats && yarn check-types
```

---

## Hedera prize tracks

### Tokenization (ATS)

1. Issue equity (`yarn ats:issue`) or reuse existing `ATS_DSTOCK`.
2. Deploy TradeLayer → `yarn configure-tradelayer` (AGENT + nominal `$0.01` + whitelist).
3. `yarn workspace @tradelayer/ats lifecycle` — KYC, mint, transfer, freeze, burn.
4. Live buy settles by minting ATS DSTOCK; redeem freezes then burns.

### Agentic payments (x402)

1. Set `X402_PAY_TO` + payer keys; optional `HCS_AUDIT_TOPIC`.
2. Start backend; run `npm run agent:x402`.
3. Expect `402` → Blocky402 settle → paid JSON; HCS audit when configured.

---

## Architecture diagrams

<img width="3108" height="854" alt="System Architecture Overview" src="https://github.com/user-attachments/assets/6b62ccb0-fb29-4a4e-afba-da34e00e6a22" />

<img width="4010" height="1772" alt="Detailed Architecture Flow" src="https://github.com/user-attachments/assets/6667dd36-39db-42aa-b205-1f39e97db455" />

---

## Tech stack

Solidity · Foundry · TypeScript · Pyth · Alpaca · Vite · Wagmi · Scaffold-ETH 2 ·
Web Crypto (ECDH + AES-GCM) · Hedera testnet (Hashio, HTS USDC, ATS, Blocky402, HCS)

---

## Roadmap leftovers

1. Cryptographic binding of settlement to sealed-order commitment.
2. Threshold signing instead of a single backend hot key.
3. Proof of reserve / broker inventory attestations.
