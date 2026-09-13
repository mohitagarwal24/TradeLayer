# TradeLayer

<img width="1316" height="578" alt="image" src="https://github.com/user-attachments/assets/85bac0eb-a8a1-4a66-a786-cccd801b8eec" />

GitBook - https://helix-5.gitbook.io/tradelayer  
PPT - https://drive.google.com/file/d/1B3c3GfzceXX_N0WlIDR1r_Dim4UsEvAJ/view?usp=sharing  
Technical Demo - https://vimeo.com/1226318363?share=copy&fl=sv&fe=ci  

---
### Confidential Trade Flow Diagram
<img width="1280" height="858" alt="image" src="https://github.com/user-attachments/assets/c5c270c0-f117-415d-ada0-fe42b01e5d49" />

### Institution Onboarding and ATS Flow Diagram
<img width="4160" height="2557" alt="image" src="https://github.com/user-attachments/assets/f8d3ad51-c5d0-4b0b-9258-391382a2e9f7" />

## 1. Introduction

TradeLayer is a confidential trading protocol that lets institutions buy and sell real-world
stocks using crypto, without broadcasting their order, their holdings, or their identity
on-chain. This project aims to unify traditional markets and cryptocurrency in one single
liquidity layer.

It combines:

- **Hedera** — for tokenized equities (via Asset Tokenization Studio), compliance enforcement, and
  self-executing escrow.
- **Chainlink CRE (Confidential Workflows)** — for order intake, reconciliation, and batch
  settlement inside a hardware-isolated enclave.
- **A real brokerage** (Alpaca paper trading) — for actual market execution and share custody
  backing every token 1:1.

Built for **ETHOnline 2026**, targeting Hedera's *Tokenization of Anything* track and Chainlink's
*Best Confidential Workflow* track.

---

## 2. Problem

On every existing on-chain venue for trading tokenized stocks, an institution's entire trading
life is public and permanent:

- **Every order, every holding, every move is visible** to anyone, forever — there is no way to
  size a position without broadcasting it.
- **Front-running** — bots watch the mempool, see an order coming, and trade ahead of it, moving
  the price against the institution before it fills.
- **Strategy leakage** — a position built over months of careful accumulation is fully visible
  within seconds of the first on-chain transaction.
- **"Just trust us" is the only existing fix** — today's alternative is handing orders to a
  centralized server that promises, with no way to verify, that it won't look or leak.
- Every current RWA tokenization platform publishes the entire state of an institution's holdings
  on-chain, in the clear, mapped directly to a wallet address.
- **Crypto-native capital is locked out of markets that don't accept crypto** — an institution
  holding stablecoins or crypto assets can't easily deploy that capital into traditional equities
  without off-ramping, adding friction, cost, and delay.

Traditional finance solved the first three problems decades ago — a large share of institutional
volume trades through private venues specifically to avoid this exposure. Crypto, so far, has done
the opposite: it put every institutional order on a public billboard and called it progress.

---

## 3. Solution

TradeLayer seals an order on the user's device before it ever leaves it, and only opens it once —
inside a hardware-verified enclave nobody, including TradeLayer itself, can inspect.

**Core guarantees:**

- **Nobody sees your order** — not bots, not other traders, not the network, not TradeLayer.
- **Nobody can front-run you** — you can't be traded ahead of on an order nobody else can read.
- **Every token is fully backed** — every unit of a tokenized stock is matched 1:1 to a real share
  held at the brokerage, provable on demand.
- **Institutions keep fine-grained control** — who can trade, how much, and in what, enforced by
  an encrypted policy the enclave alone can read.
- **Wallets can be instantly frozen** and KYC is enforced at the token level, not by policy.
- **Crypto-native liquidity reaches markets that don't accept crypto directly** — TradeLayer
  bridges blockchain-speed settlement into a real, regulated brokerage account, without the
  institution ever having to off-ramp.

At a high level, an order goes: **sealed on device → dispatched via Chainlink CRE → decrypted and
checked inside a Nitro enclave → executed once at a real broker → settled back through Hedera**,
either individually (buy escrow) or in a netted batch (sell settlement).

---

## 4. Hedera — What It's Used For, and What It Bought Us

Hedera is where every piece of persistent, verifiable state lives: the tokenized shares, the
escrow, the compliance rules, and the encrypted ledger. Nothing about a trade's *content* is
decided on Hedera — that happens inside the Chainlink enclave — but everything about a trade's
*outcome* is recorded there.

### What Hedera achieves for us

- **Real tokenized equities with enterprise-grade compliance built in**, instead of us building
  KYC/freeze/transfer-restriction logic from scratch.
- **Self-executing, trustless refunds** — if a trade doesn't complete in time, the network itself
  returns the escrowed funds. No middleman, no dependency on TradeLayer behaving correctly.
- **A public settlement layer that never has to reveal trade content** — every write to Hedera is
  either an encrypted blob, a net batch number, or a bare dollar amount, never a
  symbol-and-quantity pair tied to an institution.

### Technical building blocks used

- **Hedera Asset Tokenization Studio (ATS)**, ATS Factory, testnet v4.0.0 — issues one ERC-3643 +
  ERC-1400 equity token per stock symbol (e.g. `TSLA-t`, `FORD-t`, `VOO-t`), shared across every
  institution on the platform rather than minted per-institution.
- **ATS compliance controls in active use:** KYC-gated holding (only the vault is ever a
  KYC-verified holder of the tokens), Hold and Clearing modes, and `CLEARING_VALIDATOR_ROLE`
  granted to the enclave's H1 operator account, gated through our own `ComplianceRouter`.
- **`ComplianceRouter.sol`** (custom contract) — holds `KYC_ROLE` / `FREEZE_MANAGER_ROLE` on the
  ATS tokens only. Every `freeze` / `grantKyc` / `revokeKyc` call is checked against
  `OrgWalletRegistry` before being forwarded, so one institution's admin can never act on another
  institution's wallet. A separate, higher-friction multisig path exists for genuine
  platform-level emergencies (sanctions, court order).
- **`OrgWalletRegistry.sol`** (custom contract) — the source of truth for which institution owns
  which wallet, bound only after mutual, on-chain consent from both the wallet and the
  institution's registered admin.
- **`OrderEscrow.sol`** (custom contract) + **HIP-1215 Scheduled Transactions** — locks raw USDC
  for a buy order and schedules its own timeout refund on-chain, paid back to the vault with no
  off-chain watcher required.
- **`OmnibusVault.sol`** (custom contract) — holds the USDC reserve directly (no wrapping or
  minting of our own settlement token) and holds all ATS stock tokens pooled, minting/redeeming
  them in net batches.
- **`ConfidentialLedger.sol`** (custom contract) — one encrypted blob per account (cash,
  positions, open orders) plus one encrypted policy blob per institution, writable only by the
  enclave's operator accounts.
- **Hedera JSON-RPC relay + Mirror Node** — used by the enclave for all `eth_call` reads and
  signed transaction writes.
- We deliberately **hold no KYC/freeze keys over the settlement leg (USDC)** — that stays a
  standard external stablecoin Circle controls, not us; every compliance demo lives entirely on
  the ATS token side.

---

## 5. Chainlink — Why We Used It, and What It Bought Us

Chainlink CRE's Confidential Workflows are the reason this product can exist at all: they are the
one place an order, a balance, and a set of institutional trading rules are ever readable in
plaintext, anywhere in the system — and that place is provably not TradeLayer's own
infrastructure.

### What Chainlink achieves for us

- **Hardware-verified, trust-minimized execution** — an order is decrypted, checked, and acted on
  inside an AWS Nitro enclave whose integrity is attested before any secret is ever released to
  it.
- **No single party — including TradeLayer — can read a live order.** Decryption keys are
  threshold-secured and only released by the Vault DON after remote attestation succeeds.
- **A single secure bridge between two worlds** — the same confidential workflow reaches out to a
  real stockbroker and writes back to Hedera, so the sensitive middle step (deciding what to trade
  and for whom) never touches either endpoint in the clear.
- **Batched settlement that structurally hides trade-level detail** — because the netting logic
  itself runs inside the enclave, only the net result per symbol is ever computed in a way
  anything outside the enclave could observe.

### Technical building blocks used

- **Chainlink CRE Confidential Workflows**, written in TypeScript, with a TEE constraint of
  `nitro` / `us-west-2`.
- **Four `handlerInTee` handlers across three registered triggers**, all running inside the
  enclave. H1 and H4 share the single HTTP trigger and branch on the payload, because a deployed
  workflow may register only one HTTP trigger:
  - **H1 — Intake** (HTTP trigger, real-time, per order): opens the sealed envelope, resolves the
    caller's real institution via on-chain registry lookup, checks balance/policy, locks funds or
    checks free shares, places exactly one broker order, and writes the first ledger update.
  - **H2 — Reconcile** (cron, ~30s): polls the broker for fill status, updates the encrypted
    ledger, and releases or retires escrow.
  - **H3 — Batch settle** (cron, ~5min): nets every fill since the last run, per symbol, across
    every institution on the platform, and executes one mint/redeem call per symbol plus one
    reserve attestation for the whole batch — the mechanism that makes institution-level and
    stock-level activity disappear into the aggregate.
  - **H4 — Policy** (HTTP trigger, shared with H1): opens the admin's sealed rulebook, proves
    authorship against the registry, re-encrypts it under the institution's key, and writes the
    encrypted policy blob.
- **Workflow DON** — dispatches HTTP and cron triggers to the enclave and carries consensus
  reporting back out via `usingTheDons()`, which returns only order IDs, statuses, batch IDs, and
  a reserve-ok flag — never symbols, quantities, prices, or balances.
- **Vault DON** — holds and releases secrets (`INTENT_PRIVKEY`, `LEDGER_MASTER_KEY`,
  `BROKER_KEY_ID` / `BROKER_SECRET`, per-handler `HEDERA_OPERATOR_KEY`) only after the requesting
  enclave has been attested.
- **`SettlementAttestation.sol`**, deployed on a CRE-supported EVM chain (Hedera is not yet
  natively CRE-supported), as the consumer of the CRE forwarder — this is the on-chain state
  change Chainlink's workflow ultimately writes.
- We use **CRE, not Chainlink Functions or Automation** (disallowed for this event) — timeouts are
  instead handled by Hedera's own HIP-1215 scheduled calls, and recurring jobs by CRE's native
  cron triggers.

---

## 6. Backend Flow Diagram

<img width="4160" height="3233" alt="image" src="https://github.com/user-attachments/assets/e0e6d177-4955-4154-b1a8-dff7d36a1e13" />

---

## 7. Privacy Model

TradeLayer layers **three separate protections** rather than relying on any single one — no
existing privacy primitive is both fast enough for real-time trading and capable of handling a
shared, constantly-updating ledger on its own.

**Lock one — encrypted balances.** Every institution's and every employee's real cash balance,
share positions, open orders, and private trading rules exist only as one encrypted blob per
account inside `ConfidentialLedger`'s smart-contract mapping. That blob is decrypted in exactly
one place, for exactly as long as it takes to check or update a trade: inside the enclave. Not on
TradeLayer's servers, not by TradeLayer, not by anyone reading the chain.

**Lock two — a sealed computer.** An order is opened, checked, and acted on entirely inside a
hardware-verified Chainlink CRE enclave. Decryption keys are released by the Vault DON only after
the enclave proves it hasn't been tampered with.

**Lock three — blending at settlement.** This is where individual trades disappear into the
aggregate:

- **Buying happens in real time:** `OrderEscrow` locks funds the moment an order is submitted,
  because the trustless timeout-refund guarantee depends on that lock existing immediately. This
  step is **not** batched — the one thing it reveals is a dollar amount (roughly how large the
  order is). Which stock, and how many shares, never leaves the enclave.
- **Selling settles on a 5-minute timer inside handler H3:** every fill from every institution on
  the platform is netted per symbol, across the entire platform, and only the net result — one
  mint or redeem of that symbol's t-token — ever touches the chain. If trades cancel out within a
  window, nothing is written at all. An outside observer cannot tell how many trades fed into the
  number they see, or whose they were.

**What stays visible, on purpose:** that an account is active; the net per-symbol mint/redeem per
batch (not attributable to one institution); the wallet-to-institution registry (kept public
deliberately, so registration requires mutual on-chain consent and impersonation is structurally
impossible rather than policy-dependent); and the fully-backed reserve attestation.

**The one gap we say out loud:** locking an exact dollar amount at buy-time does leak roughly how
large that one order is. Batching protects settlement-side privacy, not that real-time escrow
lock — a pre-funded float mechanism (coarse, fixed top-up tranches drawn down privately) is the
proposed fix, not yet built as of this writing.

We describe this as **hardware-verified and trust-minimized — not "trustless."** It is the
strongest privacy guarantee that is still fast enough to actually place a trade with, and we'd
rather state that plainly than oversell it.

---

## 8. Live on Hedera testnet

All five contracts verified on HashScan (`exact_match`).

| | Address |
|---|---|
| `OrgWalletRegistry` | [`0xa85a68C09d87189B562864C77BBBbc28110ae6D9`](https://hashscan.io/testnet/contract/0xa85a68C09d87189B562864C77BBBbc28110ae6D9) |
| `ComplianceRouter` | [`0x6b7f8B75120f1F6CaeCc242581cAc99B07d05D3E`](https://hashscan.io/testnet/contract/0x6b7f8B75120f1F6CaeCc242581cAc99B07d05D3E) |
| `OmnibusVault` | [`0xdF6852804c867068271df32a32114c62b322Fed3`](https://hashscan.io/testnet/contract/0xdF6852804c867068271df32a32114c62b322Fed3) |
| `OrderEscrow` | [`0x4F59e014AEDe86A5dcf2422a45cFf82a2fC5eda9`](https://hashscan.io/testnet/contract/0x4F59e014AEDe86A5dcf2422a45cFf82a2fC5eda9) |
| `ConfidentialLedger` | [`0x458B9b009E291c5869E3d3d56709237a42e8d3b5`](https://hashscan.io/testnet/contract/0x458B9b009E291c5869E3d3d56709237a42e8d3b5) |
| `FORD-t` · `TSLA-t` · `VOO-t` | ATS equities, 9 decimals — [`0x3ca9…24ed`](https://hashscan.io/testnet/contract/0x3ca9772d1030cb74fc0b639338241105577524ed) · [`0xd085…3249`](https://hashscan.io/testnet/contract/0xd085bdb088940ece20a7ccfc064deb2824433249) · [`0x4761…766a`](https://hashscan.io/testnet/contract/0x4761355322501c098d3b0dc9b9cbbfc2d77b766a) |
| USDC | Circle native, HTS `0.0.429274` |

The Chainlink workflow is deployed to the CRE private registry, DON family `zone-a`, workflow id
`0009ba3eb7bc81d5ecea0661b377cba10e823d9c3d3c933725b1049b2f62469e`.

**What actually ran**, end to end, on testnet against the live broker:

1. An institution registered itself and funded a treasury. The pool is undifferentiated — nothing
   on-chain says whose it is.
2. Its admin admitted a member on all three equities **through `ComplianceRouter`** — the token
   itself now permits them, and no other institution's admin could have done it.
3. The admin sealed a rulebook: hundreds of bytes of ciphertext in, a version number and a blob
   out, opened only inside the enclave.
4. An employee placed a sealed order. H1 opened it in the TEE, checked the rules, and placed **one
   real order at Alpaca** — `TSLA`, notional, `status accepted`. The escrow reserved exactly that
   much of the institution's money; the employee's wallet was never touched.
5. H2 settled it atomically — shares credited and escrow released in one signed authorization —
   and wrote the encrypted position back to the ledger.

Same wallet, same second:

```
PUBLIC        omnibus reserve 80.00 USDC, of which 20.00 committed
              → one pool. No public field says which institution owns any of it.
              FORD-t / TSLA-t / VOO-t: supply 0
              ledger entry v5, 873 bytes of ciphertext
              → symbol, quantity, price, position: NOT VISIBLE ANYWHERE ABOVE

PRIVATE       positions {"TSLA":"0.013680452"} · stranger decrypt correctly rejected
```

### Verifying it yourself

Nothing here needs to be taken on trust:

| Claim | Where to check |
|---|---|
| The order reached the chain | `hashscan.io/testnet/transaction/<hash>` |
| Only an amount and a deadline are public | the `OrderOpened` event log on that transaction |
| The refund needs no keeper | `hashscan.io/testnet/schedule/<id>` — *wait for expiry*, unexecuted |
| The broker order is real | the Alpaca dashboard |
| The chain and the broker are the **same** order | `client_order_id` is the first 32 hex of the on-chain `orderId` |
| One institution cannot touch another's people | `forge test --match-test test_rivalInstitutionCannotFreezeYourEmployee -vv` |

---

## 9. Fractional by design

Equities are issued with **9 decimals** and orders are placed by **amount**, not share count —
Alpaca `notional`, minimum $1. "Spend $20 on Tesla" rather than "buy one $365 share".

That is not a workaround for a small testnet treasury. It removes the need to over-reserve against
a moving price, and with it the gapped-fill case where the vault absorbed an overage: `spent` is
simply what the broker charged.

---

## 10. Repository

```
packages/foundry/   OrgWalletRegistry · ComplianceRouter · OmnibusVault · OrderEscrow
                    ConfidentialLedger · EnclaveAuth · mocks · 87 tests
cre/                Chainlink CRE workflow: tradelayer/main.ts + src/{crypto,handlers,…}
backend/            Intake API · relayer · chain narration
packages/nextjs/    Vite + React: onboarding · institution admin · trade · positions
packages/ats/       ATS issuance and role wiring
docs/               full documentation (GitBook)
```

Full documentation lives in **[`docs/`](docs/README.md)** — architecture, data model, the
cryptography contract between the browser and the enclave, deployment, and troubleshooting.

## 11. Run it

Contracts are deployed and wired, and the backend is hosted:

```bash
curl https://tradelayer-backend.onrender.com/health
```

Locally — see **[docs/guides/running-locally.md](docs/guides/running-locally.md)** for the full
runbook, **[DEPLOY.md](DEPLOY.md)** for hosting:

```bash
cd backend && npm start     # intake + relayer + chain narration — keep this on screen
yarn start                  # http://localhost:8080
```

## 12. Tests

```bash
cd packages/foundry && forge test        # 87 — incl. 12 proving one institution
                                         # cannot touch another's people
cd cre/tradelayer && bun test            # 13 crypto vectors shared with the browser
cd backend && npx tsc --noEmit
cd backend && npx tsx scripts/checkGatewayJwt.ts   # 15 gateway JWT wire-format checks
yarn frontend:check-types && yarn frontend:lint && yarn frontend:build
```
