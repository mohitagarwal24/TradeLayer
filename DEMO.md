# Running TradeLayer yourself

Everything here runs against **Hedera testnet** and the **real Alpaca broker**. Nothing is mocked,
so nothing needs a special demo mode.

---

## 0. One-time, already done

Skip this — it's recorded so you can rebuild from scratch if you ever need to.

| | |
|---|---|
| Equities issued in [ATS Studio](https://tokenization-studio.hedera.com/) | `FORD-t`, `TSLA-t`, `VOO-t` — 9 decimals, approval list, controllable, internal KYC |
| Contracts deployed | `yarn deploy:hedera-testnet` |
| USDC association | `yarn ats:setup-hedera` |
| ATS roles wired | `yarn ats:grant-router-roles` |

Env files are already filled in: `packages/foundry/.env`, `backend/.env`, `cre/.env`,
`packages/ats/.env`, `cre/tradelayer/config/config.testnet.json`.

---

## 1. Start it

Two terminals. Add the tools to your PATH in each:

```bash
export PATH="$HOME/.foundry/bin:$HOME/.bun/bin:$HOME/.cre/bin:$PATH"
source "$HOME/.nvm/nvm.sh" && nvm use 20
```

**Terminal A — the backend. Keep this on screen; it narrates the whole demo.**

```bash
cd backend && npm start
```

Wait for:

```
enclave signer 0x56E4A47904…f034 verified on escrow, ledger and vault
chain   watching 4 contracts from block …
```

If the signer line says anything else, stop — nothing will settle.

**Terminal B — the app.**

```bash
yarn start          # http://localhost:8080
```

**Terminal C — only for settling a fill** (H2 is a scheduled job; it doesn't self-fire locally):

```bash
cd cre && cre workflow simulate ./tradelayer --target testnet-settings \
  --trigger-index 1 --non-interactive --allow-insecure-rpc
```

---

## 2. Wallets

MetaMask on **Hedera testnet** (chain 296, RPC `https://testnet.hashio.io/api`).

| Role | Needs |
|---|---|
| **Admin** — founds the institution, funds it, sets rules | HBAR for gas + USDC to deposit |
| **Employee** — asks to join, then trades | HBAR for gas only. **Never holds USDC** |

> **One wallet belongs to exactly one institution, permanently.** `registerOrg` binds the caller.
> If you want to demo "create an institution" more than once, use a **fresh admin wallet each
> time** — or reuse the existing one and skip to funding.

Top-ups: [Hedera portal](https://portal.hedera.com/) for HBAR, [Circle faucet](https://faucet.circle.com/)
for USDC (20 every 2 hours).

---

## 3. The demo

Put the browser and Terminal A side by side. Every click produces a log line.

### Beat 1 — found an institution *(admin wallet)*

`/` → **Create institution** → a name → sign.

```
org  institution "NORTHWIND" registered  admin=0x…
org  admin approved 0x… into "NORTHWIND" — both sides have now consented
```

### Beat 2 — fund it

**Institution → Capital** → amount → **Fund**. Two signatures (approve, then deposit).

```
chain  treasury funded with 40.0 USDC  org=NORTHWIND  by=0x…
```

> Say: *the money is the institution's and stays in a shared pool. There is no per-company
> balance on-chain — a labelled balance would publish exactly how much capital each firm has.*

### Beat 3 — someone asks to join *(switch to the employee wallet)*

`/` → **Ask to join** → the institution's name → sign.

```
org  0x… asked to join "NORTHWIND" — awaiting the admin
```

The employee now sees **"Waiting to be let in."** They cannot trade.

### Beat 4 — the admin lets them in *(switch back)*

**Institution → People** → **Approve**, then **Admit**.

```
org  admin approved 0x… into "NORTHWIND" — both sides have now consented
org  0x… admitted on FORD-t — the token itself now permits them
org  0x… admitted on TSLA-t …
org  0x… admitted on VOO-t …
```

> Say: *binding a wallet takes two signatures — the employee's and the admin's. Neither side can
> do it alone, which is what stops one company claiming another's wallet.*

### Beat 5 — private rules

**Institution → Rules** → max per order, the employee's address, restrict a ticker → **Seal and publish**.

```
intake   sealed policy received — rules unreadable here  ciphertext=572b
enclave  handing sealed envelope to the TEE handler  trigger=H4
enclave  TEE execution requested — AWS Nitro, us-west-2
enclave  H4 NORTHWIND: policy v1 relay confirmed
```

> Say: *those rules were encrypted in the browser. The server forwarded something it cannot read.
> The chain stores ciphertext and a version number.*

### Beat 6 — a real order *(employee wallet)*

**Trade** → pick a ticker → an amount → **Place sealed order**.

```
intake   sealed envelope received — contents unreadable here  ciphertext=628b
enclave  TEE execution requested — AWS Nitro, us-west-2
enclave  H1 0x…: envelope received
relay    enclave signature verified  signer=0x56E4A47904…
chain    ledgerUpdate CONFIRMED  block=…  gasUsed=…
enclave  H1 0x…: placed; ledger v1 relay confirmed
chain    order opened — 20.0 USDC reserved from the institution's pool
         visible=amount + deadline only
```

> Say: *the public record shows an amount and a deadline. Not the ticker, not the size.*

### Beat 7 — the rules bite *(the strongest beat)*

Publish rules that **block** the employee, or restrict the ticker they just bought. Place the
order again:

```
enclave  H1 0x…: rejected (policy: restricted symbol)
chain    order CANCELLED by the enclave — 20.0 USDC returned
```

The UI says **Order declined**, and the money is already back. Nobody intervened.

### Beat 8 — settle *(market hours only)*

Terminal C. During market hours:

```json
{ "action": "settle", "relay": "confirmed" }
```

Outside market hours you get `pending:accepted` — the order is genuinely queued at the broker.
**Show that instead**: it's more honest than a fake fill, and it proves the order is real.

### Beat 9 — the reveal

**Positions** → **Reveal** → one signature.

Before: *"Your positions are stored encrypted."* After: the actual holding. Nothing else on the
page changed — the ciphertext was always there; the signature derived the key that opens it.

---

## 4. Convincing a judge it's real

Have these open in browser tabs before you start.

### The chain — every action is a real transaction

**All five contracts are verified on HashScan** (Sourcify `exact_match` — the deployed bytecode is
byte-identical to the source). A judge can read the actual code, not just trust the transactions.

[HashScan testnet](https://hashscan.io/testnet) — paste any address:

| Contract | Address |
|---|---|
| OrgWalletRegistry | `0xa85a68C09d87189B562864C77BBBbc28110ae6D9` |
| ConfidentialLedger | `0x458B9b009E291c5869E3d3d56709237a42e8d3b5` |
| OmnibusVault | `0xdF6852804c867068271df32a32114c62b322Fed3` |
| OrderEscrow | `0xA020804EBA73B6127fc84fAD6C74b69d1c818FF2` |
| ComplianceRouter | `0x6b7f8B75120f1F6CaeCc242581cAc99B07d05D3E` |

Real gas, real timestamps, a public explorer they can refresh live while you click — and a
**Contract** tab with the verified source.

**Open the ledger contract and show a `ConfidentialLedger` storage entry** — it is bytes of
ciphertext. That is the whole argument in one screen.

### The broker — a real order in a real account

Log into [app.alpaca.markets](https://app.alpaca.markets/) (paper) → **Orders**. The order you
just placed is there, with its timestamp, and `client_order_id` matching the first 32 hex
characters of the on-chain order id. Same id, two independent systems.

```bash
# or from the terminal, live:
curl -s "https://paper-api.alpaca.markets/v2/orders?status=all&limit=5" \
  -H "APCA-API-KEY-ID: $KEY" -H "APCA-API-SECRET-KEY: $SECRET" | python3 -m json.tool
```

### The equities are real ATS securities

They came out of Hedera's **Asset Tokenization Studio factory** — we did not write them:

| | |
|---|---|
| FORD-t | `0x3ca9772d1030cb74fc0b639338241105577524ed` |
| TSLA-t | `0xd085bdb088940ece20a7ccfc064deb2824433249` |
| VOO-t | `0x4761355322501c098d3b0dc9b9cbbfc2d77b766a` |

Open one on HashScan: 9 decimals, an approval list, a KYC registry. Ask a judge to check that
your employee's wallet appears on the control list only **after** you admitted them.

### The prices are live

The number on the Trade screen is Alpaca's last trade. Pull up Google Finance next to it.

### Let them try to break it

The most convincing thing you can do. Hand a judge a wallet, or use a third MetaMask account:

- **Trade without joining** → `openBuy` reverts, `NotRegistered`.
- **Freeze another institution's employee** → reverts, `NotYourWallet`. Show the test that proves
  it: `forge test --match-test test_rivalInstitutionCannotFreezeYourEmployee -vv`.
- **Read someone else's positions** → their wallet derives a different key; decryption fails.

```bash
cd packages/foundry && forge test        # 86 tests, 12 of which prove one institution
                                         # cannot touch another institution's people
```

### One honest line to say out loud

> The enclave runs through `cre workflow simulate` — the same compiled WASM, the same handlers,
> but live Confidential Workflow deployment is still in private beta. Everything else is real:
> real chain, real broker, real securities.

Judges trust a team that names its own limitation before they find it.

---

## 5. If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Backend says a contract trusts a different signer | wrong `ENCLAVE_SIGNER` | check it matches `cre/.env`'s signing key |
| `/health` shows chain 31337 | a stale backend from an old session | `pkill -f "tsx index.ts"`, restart |
| `NotRegistered` on an order | that wallet never joined | admin must **Approve** it |
| Order sits at "Sent to the market" | market is closed | expected — say so |
| `AccountIsNotIssuer` | issuer not on the SSI list | `yarn ats:grant-router-roles` (idempotent) |
| Enclave step hangs | `cre` not logged in | `cre login` |
| UI loads but nothing works | Vite moved to 8081 because 8080 was taken — CORS then blocks every call | `ss -ltnp \| grep :8080`, kill it, restart |
| Transaction reverts with no reason | Hashio under-estimates gas | already handled by `RELAY_GAS_LIMIT` |

**Reset for a clean run:** use a fresh admin wallet and a new institution name. Contracts do not
need redeploying. To clear local order history: `rm -rf backend/.data`.

---
