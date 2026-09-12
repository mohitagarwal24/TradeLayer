# TradeLayer — 2-minute demo script

Recorded **Sat 12 Sep 2026**, US market closed. The order is genuinely queued at the broker; say so
on camera. A judge who opens your Alpaca dashboard will see exactly that, and saying it first is
much stronger than being caught by it.

---

## Before you hit record

**Screen layout.** Browser left, backend terminal right, both visible the whole time. The terminal
is the evidence — don't cut away from it during the order.

```bash
# Terminal (right of screen, make the font large)
cd backend && npm start
#   wait for: enclave signer 0x56E4…f034 verified on escrow, ledger and vault
#             chain   watching 5 contracts from block …

# Second terminal, then hide it
yarn start        # must say 8080 — if it says 8081, kill whatever holds 8080 first
```

**Check before recording:**

| | |
|---|---|
| `curl localhost:8000/market/clock` | must show `"isOpen":false` |
| Admin wallet `0x2325…D8BC` | admin of **ACME**, treasury **80 USDC**, rules **v3** |
| Employee wallet | needs HBAR for gas — **never** USDC, that's the point |
| Both wallets | MetaMask on **Hedera Testnet (296)** |

**Timing.** Each sealed action takes **20–30 s** in the enclave. That's real work, not a hang. Cut
or speed-ramp it in the edit and narrate over it — it's the single biggest constraint on 120 s.

**Do not** double-click any write. One relayer key, no nonce queue.

---

## The script

### 0:00 – 0:12 · The problem
*Landing page.*

> "Put an institution's trading on a public blockchain and you publish its order flow, its
> positions and its size — to competitors, and to anyone who wants to trade ahead of it.
> TradeLayer removes that exposure without handing trust to a server."

### 0:12 – 0:30 · The institution
*Institution page, admin wallet. Treasury and People visible.*

> "An institution registers on-chain and funds a single pooled USDC treasury. Membership takes
> **two signatures** — the employee's wallet proposes, the admin approves. One wallet belongs to
> one institution, which is what makes it impossible for one firm to touch another firm's people."

**Action:** approve the pending join request. Terminal prints the `org` lines.

### 0:30 – 0:45 · Compliance
*People card, click Admit.*

> "Admitting someone isn't a flag in our database — it's written into the **ATS equity token
> itself**, through a compliance router that checks the registry before it will act. Suspend
> someone and the token stops them, not the app."

### 0:45 – 1:00 · The private rulebook
*Rules card.*

> "The admin's limits — who may trade, how much per order, which stocks are off-limits — are
> encrypted in the browser before they leave it. They're checked on every order and they can't be
> read back. Not by us, not even by the admin who wrote them."

### 1:00 – 1:22 · The order
*Switch to the employee wallet. Trade page. $5 on TSLA.*

> "The employee signs the order, sealed client-side. The escrow draws from the **institution's**
> treasury — the employee never holds company money at any point. Traders get authority, not
> custody. That's how a real desk works."

**Action:** Place sealed order. Two wallet popups: the portfolio key, then the order.

### 1:22 – 1:45 · The proof — *full-screen the terminal here*

> "The backend receives ciphertext and holds no key that can open it — it says so itself."

*Point at the `intake` block: ephemeral key, nonce, 628 bytes, "this process holds no key".*

> "It's opened only inside a Chainlink Confidential Workflow on AWS Nitro. Same bytes — readable
> there and nowhere else. It checks the firm's private rules, and places **one real order at
> Alpaca**."

*Point at the enclave block, then the grey `broker` lines.*

> "The market is closed right now, so it's genuinely queued at the broker — `filled_qty` zero,
> waiting for Monday's open. Not faked into a fill."

### 1:45 – 1:57 · What the world sees
*Terminal `chain` line, then Positions → Reveal.*

> "On Hedera, everything public about that order is an amount and a deadline. Not the stock, not
> the share count, not the price, not who benefits. The position exists only as ciphertext, and
> only its owner holds the key."

### 1:57 – 2:00 · Close

> "Five verified contracts on Hedera testnet, and the workflow deployed and live on Chainlink's
> network."

---

## What the terminal will show

Verified live at 14:23 today, TSLA $5 (abridged):

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
`envelope opened — {"symbol":"TSLA"…}`. Same bytes, opaque in one process and readable in the next,
with CRE's own disclaimer in between. That is the whole architecture on one screen.

---

## If a judge digs

| They ask | Show them |
|---|---|
| "Is the broker real?" | Alpaca dashboard — search the `id` from the terminal. Same order. |
| "Is the chain real?" | HashScan, the five verified contracts (Sourcify `exact_match`) |
| "Is the enclave real?" | `cre workflow get ./tradelayer --target testnet-settings` → `ACTIVE`, workflow `0009ba3e…469e` |
| "Can one firm touch another's people?" | `forge test --match-test test_rivalInstitutionCannotFreezeYourEmployee -vv` |
| "Why didn't it fill?" | `curl localhost:8000/market/clock` → `isOpen:false`, next open Mon 09:30 ET |

## Say these, don't hide them

- The market is closed; the order is queued, not filled.
- The enclave runs through `cre workflow simulate` locally — same compiled WASM, same handlers.
  The workflow **is** deployed on CRE; confidential HTTP consensus is a beta limitation we've
  reported.
- The escrow leaks order size. An amount is visible even though the symbol isn't.
