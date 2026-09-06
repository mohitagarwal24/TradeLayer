# TradeLayer Protocol

A protocol for trading real-world equities with stablecoins: escrow USDC on-chain, submit an
**encrypted** order intent, have an off-chain service execute it at a regulated broker, and settle the
resulting position back on-chain.

Targets **Hedera testnet** for ETHOnline 2026 (tokenization + agentic payments tracks). No mainnet.

- **Demo:** [Watch on YouTube](https://www.youtube.com/watch?v=KfeFqoLg0nE&feature=youtu.be)
- **Deck:** [Canva](https://www.canva.com/design/DAG6qVimow0/y0wbJBTPGFYrGahnf-PRSQ/edit)

---

## Status and security notice

Read this before using anything here.

**1. The Base Mainnet deployment at `0x5c7B3c7AC4640d5eB9424e93F10F9ab299516333` is vulnerable. Do not
send it funds.** In that deployed version, `fulfillRequest` had **no access control**. This is fixed in
the current source tree, but **the fix is not deployed to that address**. Do not use mainnet for this
project — everything runs on local Anvil or Hedera testnet.

**2. Alpaca API credentials were committed to this repository's git history.** They have been removed
from the source tree and revoked. Credentials now come from the environment only — see [Setup](#setup).

**3. This is a hackathon prototype.** Sections below distinguish what is **implemented** from what is
still in progress (ATS migration, x402 agentic payments).

---

## Problem statement

Equity markets and crypto markets are separated by regulatory and infrastructure silos. Crypto offers
speed, global access, and self-custody; traditional equity markets offer regulated structure and deep
liquidity. Moving between them means off-ramping to fiat, opening a brokerage account in a supported
jurisdiction, and giving up self-custody of the capital in transit.

TradeLayer's goal is a single venue where a user holding stablecoins can take an equity position
without leaving the chain, and without broadcasting that position to the mempool before it fills.

---

## What is implemented

### On-chain: `TradeLayer.sol`

An ERC20 (`dstock` / `DSTOCK`, 0 decimals, non-transferable) that doubles as escrow and position
register. Prices come from **Pyth** equity feeds (Hermes for live UI; on-chain `IPyth` for settlement).

| Function | Behaviour |
|---|---|
| `buyStock(orderId, encryptedOrder, amountOfUsdc)` | Pulls USDC into escrow, records the request, emits `RequestCreated` with the encrypted intent. Rejects a reused `orderId`. Adds the amount to `escrowedBuyUsdc`. |
| `redeemStock(orderId, encryptedOrder, amount)` | Locks `amount` of the caller's DSTOCK against the request (`lockedForRedeem`) so the same balance cannot back two redemptions. Rejects a reused `orderId`. |
| `fulfillRequest(orderId, result)` | **`onlyBackend`.** Settles exactly once per `orderId`. Mints DSTOCK, credits `totalHoldings`, and refunds any unspent escrow on a buy; burns, debits, and pays out sale proceeds on a redeem. |
| `getStockPrice` / `getStockPriceUnsafe` | Reads a Pyth equity feed, scaled to 18 decimals. |
| `getStockHoldings(user)` | Returns the full stock-symbol list for a user. |
| `addStock`, `setBackendWallet` | **`onlyOwner`.** |

Settlement reads the request by the **`orderId` parameter**, not by the `orderId` inside the
backend-supplied `result` bytes. Buy escrow is segregated via `escrowedBuyUsdc`.

### Off-chain: order encryption

Frontend `packages/nextjs/src/lib/sealOrder.ts` — ECDH on P-256 with the backend's static public key
(from `GET /public-key`), AES-GCM encrypts the order JSON, and the per-order ephemeral public key is
posted to `POST /ephemeral-key`. Only ciphertext + IV go on-chain in `RequestCreated`.

### Off-chain: settlement service

`backend/` — Express service that:

- Serves `/public-key` and `/ephemeral-key` for the privacy scheme
- Listens for `RequestCreated`, decrypts via ephemeral ECDH, places the order at Alpaca
- Watches Alpaca `trade_updates`, then calls `fulfillRequest` with filled symbol/quantity
- Points at Hedera testnet Hashio RPC and Circle HTS USDC (`0.0.429274`) when configured

### Frontend

`packages/nextjs/` — Vite + React dApp on Scaffold-ETH 2 hooks (`useScaffoldReadContract` /
`useScaffoldWriteContract`). Live Pyth Hermes prices, real USDC approve + buy/redeem with sealed
orders, portfolio holdings via `getStockHoldings`.

---

## What is designed but NOT yet complete

| Component | Intended role | Actual state |
|---|---|---|
| **Hedera Asset Tokenization Studio (ATS)** | Re-issue DSTOCK as an ATS ERC-3643 token with KYC/compliance | Implemented — TradeLayer mints/burns via `IAtsSecurityToken`; `packages/ats` issues equity + lifecycle demo |
| **x402 / Blocky402 agentic payments** | Pay-per-call order-status API settled in HTS USDC | Implemented — `GET /order-status/:id` and `/portfolio/:addr` gated via Blocky402; `npm run agent:x402` |
| **Lit Protocol MPC** | Threshold-sign settlements | Not implemented — backend uses a single hot key |
| **Chainlink Proof of Reserve** | Broker inventory attestations | Not implemented |

### Known gaps in what *is* implemented

- **Position privacy does not hold.** `totalHoldings` / `stockHoldings` are public; encryption buys
  **pre-settlement confidentiality** only.
- **Settlement is not cryptographically bound to intent.** The backend still supplies fill bytes without
  a commitment check of the sealed order.
- **No cancellation path.** Unsettled buys/redeems stay locked indefinitely.
- **Whole shares only.** `decimals()` returns 0.

---

## Invariant testing

Stateful fuzzing with Foundry. Config: `runs = 256` (`foundry.toml`).

Eight invariants in `packages/foundry/test/invariant/Invariant.t.sol` cover USDC conservation,
supply vs holdings, settlement matching intent, transfer disabled, escrow segregation, and more.

```bash
cd packages/foundry
forge test
forge test --match-path 'test/invariant/*' -vv
```

---

## Repository layout

```
packages/foundry/          Solidity contracts, tests, deploy scripts (Anvil + Hedera testnet)
  contracts/TradeLayer.sol
  contracts/mocks/         Local USDC + Pyth stand-ins (Anvil only)
  test/invariant/
  script/Deploy.s.sol
packages/nextjs/           Vite frontend (@tradelayer/frontend)
backend/                   Settlement + key-exchange API (Hedera testnet / Alpaca)
```

---

## Setup

Requires Node 18+, Yarn, and [Foundry](https://book.getfoundry.sh/getting-started/installation).

```bash
yarn install
cd packages/foundry && forge build && forge test
```

```bash
cp backend/.env.example backend/.env
# Optional: packages/foundry/.env with PRIVATE_KEY for Hedera testnet deploy
```

| Variable | Used by | Purpose |
|---|---|---|
| `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY` | backend | Alpaca API credentials |
| `ALPACA_PAPER` | backend | Paper trading unless set to `false` |
| `HEDERA_RPC_URL`, `contract`, `private_key` | backend | Hashio RPC, TradeLayer address, settle signer |
| `BACKEND_ECDH_JWK` | backend | Persist backend ECDH keypair (auto-generated on first run if unset) |
| `VITE_BACKEND_URL` | frontend | Defaults to `http://localhost:8000` |

```bash
# Terminal 1 — local chain
yarn chain

# Terminal 2 — deploy + generate ABIs
yarn deploy

# Terminal 3 — frontend
yarn start

# Terminal 4 — settlement backend
cd backend && npx tsx index.ts
```

Hedera testnet deploy (requires funded deployer + `PRIVATE_KEY` in `packages/foundry/.env`):

```bash
yarn deploy:hedera-testnet
# then: make -C packages/foundry verify ADDRESS=0x...
```

---

## Tech stack

Solidity · Foundry · TypeScript · Pyth Network · Alpaca · Vite · Wagmi · Scaffold-ETH 2 hooks ·
Web Crypto (ECDH P-256 + AES-GCM) · Hedera testnet (Hashio, HTS USDC)

---

## Architecture diagrams

These describe the **intended** end-state, including components still in progress above.

<img width="3108" height="854" alt="System Architecture Overview" src="https://github.com/user-attachments/assets/6b62ccb0-fb29-4a4e-afba-da34e00e6a22" />

<img width="4010" height="1772" alt="Detailed Architecture Flow" src="https://github.com/user-attachments/assets/6667dd36-39db-42aa-b205-1f39e97db455" />

---

## Hedera prize tracks

### Tokenization (ATS)

1. `cd packages/ats && yarn issue-equity` — create DSTOCK equity via ATS factory (MetaMask on Hedera testnet).
2. Put the printed `evmDiamondAddress` into `packages/foundry/.env` as `ATS_DSTOCK=0x...`.
3. `yarn deploy:hedera-testnet` then grant TradeLayer the ATS Minter/Agent role.
4. `yarn workspace @tradelayer/ats lifecycle` — KYC grant + transfer + freeze (required lifecycle op).
5. `make -C packages/foundry verify ADDRESS=0x...` — Sourcify / HashScan verification.

Local Anvil uses `MockAtsSecurityToken` automatically (`yarn chain` + `yarn deploy`).

### Agentic payments (x402)

1. Fund a Hedera testnet account; set `X402_PAY_TO`, `HEDERA_ACCOUNT_ID`, `HEDERA_PRIVATE_KEY` in `backend/.env`.
2. Optional: create an HCS topic and set `HCS_AUDIT_TOPIC` for payment audit trails.
3. `cd backend && npm start` — exposes paid `GET /order-status/:orderId` and `GET /portfolio/:address`.
4. `cd backend && npm run agent:x402` — agent discovers 402, pays via Blocky402, completes one request.

## Roadmap (ETHOnline 2026)

1. **ATS migration** — issue DSTOCK via Asset Tokenization Studio (ERC-3643) with KYC/compliance on
   Hedera testnet; verify on HashScan; demo a lifecycle op.
2. **x402 agentic payments** — gate order-status behind Blocky402; agent completes a paid request;
   HCS audit trail.
3. **Bind settlement to intent** — commit `keccak256(orderPreimage)` at request time.
4. **Cancellation path** with timeout for locked redeem / escrowed buy USDC.
5. **Replace single hot signing key** with threshold signing.


## Demo recording checklist

Two ≤5-minute videos for Hedera prize qualification (record when testnet keys are funded):

1. **ATS tokenization** — issue/show DSTOCK diamond on HashScan, grant KYC, compliance transfer, TradeLayer buy settle minting ATS shares, Sourcify-verified TradeLayer.
2. **x402 agentic payment** — start backend, run `npm run agent:x402`, show 402 → Blocky402 settle → paid order-status JSON; optional HCS topic message.

