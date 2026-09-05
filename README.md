# TradeLayer Protocol

A protocol for trading real-world equities with stablecoins: escrow USDC on-chain, submit an
**encrypted** order intent, have an off-chain service execute it at a regulated broker, and settle the
resulting position back on-chain.

- **Demo:** [Watch on YouTube](https://www.youtube.com/watch?v=KfeFqoLg0nE&feature=youtu.be)
- **Deck:** [Canva](https://www.canva.com/design/DAG6qVimow0/y0wbJBTPGFYrGahnf-PRSQ/edit)

---

## ⚠️ Status and security notice

Read this before using anything here.

**1. The Base Mainnet deployment at `0x5c7B3c7AC4640d5eB9424e93F10F9ab299516333` is vulnerable. Do not
send it funds.** In that deployed version, `fulfillRequest` had **no access control** — the
`onlyBackend` modifier existed but was never applied, and `backendWallet` was never assigned. Anyone
could call it with arbitrary bytes to mint unbacked DSTOCK or drain escrowed USDC. This is fixed in
the current source tree (`onlyBackend` is now enforced and `backendWallet` is set in the constructor),
but **the fix is not deployed to that address**.

**2. Alpaca API credentials were committed to this repository's git history.** They have been removed
from the source tree, but git history is public and must be assumed compromised. Those keys are
revoked; any clone of this repo predating the removal contains them. Credentials now come from the
environment only — see [Setup](#setup).

**3. This is a hackathon prototype.** The sections below are split into what is **implemented** and
what is **designed but not implemented**. Earlier versions of this README did not make that
distinction and claimed several components that do not exist in code. That has been corrected.

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
register.

| Function | Behaviour |
|---|---|
| `buyStock(orderId, encryptedOrder, amountOfUsdc)` | Pulls USDC into escrow, records the request, emits `RequestCreated` with the encrypted intent. Rejects a reused `orderId`. Adds the amount to `escrowedBuyUsdc`. |
| `redeemStock(orderId, encryptedOrder, amount)` | Locks `amount` of the caller's DSTOCK against the request (`lockedForRedeem`) so the same balance cannot back two redemptions. Rejects a reused `orderId`. |
| `fulfillRequest(orderId, result)` | **`onlyBackend`.** Settles exactly once per `orderId`. Mints DSTOCK, credits `totalHoldings`, and refunds any unspent escrow on a buy; burns, debits, and pays out sale proceeds on a redeem. |
| `getStockPrice(symbol, priceUpdate)` | Reads a Pyth equity feed, scaled to 18 decimals. |
| `addStock`, `setBackendWallet` | **`onlyOwner`.** |

Settlement reads the request by the **`orderId` parameter**, not by the `orderId` inside the
backend-supplied `result` bytes, so a settlement cannot be attributed to a different user's order. On
redemption, the settled quantity must equal the quantity committed at request time
(`res.stockQuantity == req.tokenBalance`) and the user must actually hold it.

**Buy escrow is segregated.** `escrowedBuyUsdc` tracks USDC held against unsettled purchases, and a
redemption payout may only draw on the balance *above* that figure. Without this, redemption proceeds
and buy escrow shared one pool, so paying out a redeem could spend USDC escrowed against someone
else's unfilled order. A buy refund is likewise capped at what that order escrowed.

### On-chain: `OracleAggregator.sol`

A standalone multi-oracle price validator, `onlyOwner`-configured:

1. Fetch Pyth and Chainlink for the symbol.
2. Both valid and within 30% → use their median. Both valid but diverging >30% → tiebreak by picking
   whichever is closer to the running TWAP.
3. Only one valid → accept it only if within 30% of TWAP, else revert.
4. Circuit breaker: reject any move >10% inside a 5-minute window.
5. Update the TWAP with the accepted price.

> **Not wired in.** `TradeLayer.sol` calls Pyth directly and never calls `OracleAggregator`. Treat this
> contract as validated-but-unintegrated; integrating it is tracked work, not a shipped feature.

### Off-chain: order encryption

`clientSide/encrypt.ts` — ECDH on P-256 to derive a shared secret between the user and the service,
then AES-GCM to encrypt the order JSON (`{stock, qty, orderType}`). Only the ciphertext and IV go
on-chain in `RequestCreated`. The service decrypts with its half of the ECDH pair.

### Off-chain: settlement service

`backend/` — listens for `RequestCreated`, decrypts the intent, places the order at Alpaca
(`createOrder`), watches the `trade_updates` WebSocket for the fill, then calls `fulfillRequest` with
the filled symbol and quantity.

### Off-chain: MCP server

`clientSide/index.ts` — a FastMCP server exposing `buyStock`, `sellStock`, `checkOrder`, and
`checkHoldings` as tools, so an LLM agent can trade through the protocol conversationally.

### Frontend

`packages/nextjs/` — Scaffold-ETH 2 app. **The trading UI is a mock:** `TradingCard.tsx` uses a
hardcoded `MOCK_RATES` table and its `handleTrade` only fires a toast. The working paths today are the
MCP server and the scripts in `clientSide/`.

---

## What is designed but NOT implemented

These appear in the architecture diagrams and the deck. They are **not in the code**. They are listed
here so the diagrams aren't mistaken for a description of the running system.

| Component | Intended role | Actual state |
|---|---|---|
| **Lit Protocol MPC** | Shard the service key across nodes; threshold-sign settlements so no single party holds signing authority | **Not implemented.** The backend signs with a single hot key from `process.env.private_key`. |
| **Chainlink Proof of Reserve** | Publish broker inventory attestations on-chain and enforce collateralization programmatically | **Not implemented.** There is no proof of reserve. Backing is trust-in-the-operator. |
| **Dynamic staking / slashing** | Operator stakes ETH, slashable by user governance vote on misbehaviour | **Not implemented.** No stake, no governance, no slashing. |
| **Multi-oracle validation in the trade path** | Price every trade through `OracleAggregator` | Contract exists and is tested; `TradeLayer` does not call it. |

### Known gaps in what *is* implemented

Stated plainly, because these bound what the protocol can honestly claim:

- **Position privacy does not hold.** `totalHoldings` and `stockHoldings` are `public` mappings, so any
  observer can read exactly which symbols an address holds and how many. `clientSide/readContract.ts`
  does precisely this. What the encryption actually buys is **pre-settlement confidentiality** — the
  order is hidden while it is in flight, which defeats front-running of that order. It does not hide
  the resulting position. The DSTOCK "asset-agnostic token" design would only deliver position privacy
  if the per-symbol register were removed or replaced with commitments; it isn't.
- **Settlement is not verifiable.** `fulfillRequest` is now access-controlled, but the backend still
  supplies the symbol and quantity as arbitrary bytes with no proof they match the encrypted order or
  the broker's fill. An honest backend cannot demonstrate its honesty, and a compromised one can
  misreport a buy. Binding settlement to a commitment of the order intent is the top open item.
- **No cancellation path.** If a redeem request never settles, the user's DSTOCK stays in
  `lockedForRedeem` permanently, and if a buy never settles its USDC stays in `escrowedBuyUsdc`. There
  is no timeout or refund.
- **Whole shares only.** `decimals()` returns 0; fractional positions are not representable.

---

## Invariant testing

Stateful fuzzing with Foundry, using a handler that models each actor's *intended* per-stock holdings
in ghost state and settles every request against the symbol and quantity that request actually
committed to. Config: `runs = 256` (`foundry.toml`).

Eight invariants are asserted in `packages/foundry/test/invariant/Invariant.t.sol`:

| # | Invariant | Property |
|---|---|---|
| 1 | `invariant_usdcConservation` | `usdc.balanceOf(tradeLayer) ≥ Σ pending buy USDC` — escrow always covers unfilled purchases. |
| 2 | `invariant_tokenSupplyEqualsHoldings` | `totalSupply() == Σ totalHoldings[user][stock]` — no token inflation relative to the register. |
| 3 | `invariant_settlementMatchesIntent` | On-chain `totalHoldings` equals the handler's intended holdings — a settlement attributed to the wrong user, symbol, or quantity breaks this. |
| 4 | `invariant_userBalanceCoversHoldings` | `balanceOf(user) ≥ Σ totalHoldings[user][stock]` — no phantom positions. |
| 5 | `invariant_transfersDisabled` | `transfer`/`transferFrom` always revert. |
| 6 | `invariant_ghostVariableConsistency` | `minted − burned == totalSupply()`. |
| 7 | `invariant_noDuplicateOrderProcessing` | Settlements performed == `orderId`s flagged processed — double-settling breaks this. |
| 8 | `invariant_buyEscrowSegregated` | `escrowedBuyUsdc == Σ pending buy USDC` — the contract's own reserve figure tracks reality, which is what makes #1 structural rather than incidental. |

**Correcting an earlier claim.** A previous version of this README advertised "6 invariants, all
holding, protocol proven secure." In that suite invariant #3 was literally `assertTrue(true)` — a
no-op — and the handler faked encrypted orders and picked a **random** symbol at settlement time, so it
structurally could not detect a settlement that disagreed with its order. Five invariants were real,
one was vacuous, and the single most important property was untestable. Invariant #3 above now asserts
that property for real, and the handler settles against committed intent.

Note also what invariant testing does and does not establish: it exercises these eight properties
against fuzzed sequences of handler calls. It is not a proof of security, and it says nothing about the
off-chain components, which is where the trust currently sits.

Reproduce with:

```bash
cd packages/foundry
forge test                       # all tests
forge test --match-path 'test/invariant/*' -vv   # invariants + call summary
```

---

## Repository layout

```
packages/foundry/          Solidity contracts, tests, deploy scripts
  contracts/TradeLayer.sol         escrow + position register + DSTOCK
  contracts/OracleAggregator.sol   multi-oracle validator (not yet wired in)
  test/invariant/                  handler-based stateful fuzzing
  script/DeployTradeLayerBase.s.sol
packages/nextjs/           Scaffold-ETH 2 frontend (trading UI is mocked)
backend/                   settlement service: event listener, Alpaca, contract calls
clientSide/                MCP server, order encryption, contract read/write scripts
```

---

## Setup

Requires Node 18+, Yarn, and [Foundry](https://book.getfoundry.sh/getting-started/installation).

```bash
yarn install
cd packages/foundry && forge build && forge test
```

Both services read credentials from the environment. **Never commit a filled-in `.env`** — `.gitignore`
covers `backend/.env` and `clientSide/.env`.

```bash
cp backend/.env.example backend/.env
cp clientSide/.env.example clientSide/.env
```

| Variable | Used by | Purpose |
|---|---|---|
| `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY` | both | Alpaca API credentials |
| `ALPACA_PAPER` | both | Paper trading unless set to `false` |
| `alchemy_rpc_url`, `private_key`, `contract` | both | RPC endpoint, signer, deployed address |
| `BACKEND_PRIVATE_KEY`, `USER_PUBLIC_KEY` | backend | ECDH half for decrypting intents |
| `USER_PRIVATE_KEY`, `BACKEND_PUBLIC_KEY` | clientSide | ECDH half for encrypting intents |

Both `alpacaClient.ts` modules throw at import time if the Alpaca variables are missing, rather than
falling back to a default.

Run the services:

```bash
cd backend    && npx tsx eventListener.ts   # settlement service
cd clientSide && npx tsx index.ts           # MCP server (:8081, proxied at :3000/mcp)
```

---

## Tech stack

Solidity · Foundry · TypeScript · Pyth Network · Chainlink aggregator interface · Alpaca · Next.js /
Scaffold-ETH 2 · FastMCP · Web Crypto (ECDH P-256 + AES-GCM)

---

## Architecture diagrams

These describe the **intended** end-state, including the components marked not-implemented above.

<img width="3108" height="854" alt="System Architecture Overview" src="https://github.com/user-attachments/assets/6b62ccb0-fb29-4a4e-afba-da34e00e6a22" />

<img width="4010" height="1772" alt="Detailed Architecture Flow" src="https://github.com/user-attachments/assets/6667dd36-39db-42aa-b205-1f39e97db455" />

<details>
<summary>Planned MPC signing (Lit Protocol) — not implemented</summary>

<img width="1400" height="786" alt="MPC Architecture" src="https://github.com/user-attachments/assets/f7b455a7-45a3-4c64-aae8-c4a802e91826" />

<img width="2683" height="952" alt="MPC Signing Flow" src="https://github.com/user-attachments/assets/db1d2580-bf35-4822-a810-c9d2bb982ad1" />

</details>

<details>
<summary>Planned Chainlink Proof of Reserve — not implemented</summary>

<img width="1450" height="731" alt="Proof of Reserve Flow" src="https://github.com/user-attachments/assets/12a673a1-d964-4707-8ebe-46bcc10f3e13" />

<img width="2547" height="949" alt="Reserve Attestation Process" src="https://github.com/user-attachments/assets/85993b81-6332-487e-8dac-74f84321c834" />

</details>

---

## Roadmap

Ordered by how much each one closes the gap between the claims and the code:

1. **Bind settlement to intent.** Commit `keccak256(orderPreimage)` at request time; require the
   preimage at settlement and verify the hash before minting. This is what makes the protocol's central
   claim true.
2. **Publish an immutable audit trail** of every order and fill receipt, so settlement behaviour is
   independently auditable rather than taken on trust.
3. **Decide the privacy claim.** Either replace the plaintext per-symbol register with commitments, or
   drop the position-privacy claim and assert only pre-settlement confidentiality.
4. **Wire `OracleAggregator` into the trade path** so trades price through the validated feed.
5. **Add a cancellation path** with a timeout that releases `lockedForRedeem`.
6. **Replace the blanket transfer revert with a real compliance module** (ERC-3643 style), so transfers
   are conditionally allowed between eligible holders instead of universally blocked.
7. **Replace the single hot signing key** with threshold signing.
