# TradeLayer — 2:30 demo script

Recorded **Sat 12 Sep 2026**. The US market is shut, so **demo mode is on**: the fill is simulated
locally at the real last-traded price, and everything downstream of it — the settlement, the escrow
release, the encrypted position — is a genuine Hedera transaction.

**Say the word "simulated" once, on camera, at the fill.** It costs four seconds. The alternative is
a judge finding `filled_qty 0` in Alpaca after watching a fill, and disbelieving the real parts too.
The terminal labels it for you, so you only have to read what is on screen.

Roughly **half this video is external proof**: HashScan, Alpaca, Chainlink's dashboard, Hedera's
own tokenization studio. Judges believe what they can check themselves.

---

## Your wallets — both ready, nothing left to set up

| | Address | HBAR | USDC | Bound to an institution |
|---|---|---|---|---|
| **Admin** | `0x50C6e2a9BD9791286CaaFF169Efc4327F60cA9Cd` | 500 | **40** | no — free to register |
| **Employee** | `0xf3911D3810e273342f118F8859fF2A03807d8dAA` | 500 | **0** | no — free to join |

**No token association was needed.** Both accounts came from the Hedera portal with
`max_automatic_token_associations: -1`, so USDC associated itself on arrival. I sent 40 USDC to the
admin ([tx `0x29a5a225…`](https://hashscan.io/testnet/transaction/0x29a5a2259875900ac27c17f89d3ed51074ff3f57bea03b1fb5e0b5aed648e52b)).

**The employee holds zero USDC on purpose** — and that is worth saying out loud. They will place a
real order against the firm's money without ever holding any of it.

Institution name: **NORTHWIND CAPITAL** — confirmed free, and `registerOrg` dry-runs clean from
your admin wallet. (`NORTHWIND`, `MERIDIAN CAPITAL`, `ASHFORD PARTNERS` are also free.)

---

## How to shoot this

**Record one continuous take of ~6–8 minutes, then compress to 2:30.** There are nine wallet
signatures and two enclave runs; at 4–8× the mechanical parts collapse to about 40 seconds of
screen time and leave you ~110 seconds of narration over them. Nothing is faked — it is the same
take, sped up.

| Step | Real time | Screen time after the edit |
|---|---|---|
| Register institution | ~8 s | 3 s |
| Fund treasury (approve + deposit) | ~15 s | 4 s |
| Employee asks to join | ~8 s | 3 s |
| Admin approves | ~8 s | 3 s |
| Admit on the equities | ~10 s | 3 s |
| Publish the rulebook | ~35 s (enclave) | 5 s |
| Place the order | ~40 s (enclave) | 8 s |
| Run H2, fill + settle | ~35 s (enclave) | 6 s |

**Never double-click a write.** One relayer key, no nonce queue.

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
| 2 | [OrderEscrow on HashScan](https://hashscan.io/testnet/contract/0x4F59e014AEDe86A5dcf2422a45cFf82a2fC5eda9) | verified contract |
| 3 | [USDC `0.0.429274`](https://hashscan.io/testnet/token/0.0.429274) | Circle's own token — we issue nothing |
| 4 | [TSLA-t `0.0.10494983`](https://hashscan.io/testnet/contract/0xd085bdb088940ece20a7ccfc064deb2824433249) | the ATS equity |
| 5 | [tokenization-studio.hedera.com](https://tokenization-studio.hedera.com/) | Hedera's own ATS app, TSLA-t loaded |
| 6 | [Alpaca paper orders](https://app.alpaca.markets/paper/dashboard/orders) | the broker, logged in |
| 7 | [app.chain.link/cre/workflows](https://app.chain.link/cre/workflows) | the deployed workflow |
| 8 | blank — for the live transaction |

### The command that saves the take

After the order lands, in a spare terminal:

```bash
cd backend && npx tsx --env-file=.env scripts/proofLinks.ts
```

It prints every verifiable link for **that** order — the Hedera transaction, the scheduled refund,
the exact `client_order_id` to search in Alpaca. Copy from there; never type an explorer URL on
camera.

### Demo mode — on now, must come off after

| Where | What | Committed? |
|---|---|---|
| `backend/.env` | `DEMO_MARKET_OPEN=true` — reports the market open, hides the closed banner | no (gitignored) |
| `cre/tradelayer/config/config.testnet.json` | `broker.simulateFill: true` | **no — uncommitted** |
| `cre/tradelayer/src/broker.ts` | `simulateFillOutsideHours()` | **no — uncommitted** |
| `backend/src/org.ts`, `src/config.ts` | the switches above | **no — uncommitted** |

```bash
./revert-demo.sh     # removes all of it; git status goes clean
```

### Last checks

- `curl localhost:8000/market/clock` → `"isOpen":true,"demo":true`
- Both wallets in MetaMask on **Hedera Testnet (296)**
- MetaMask set to the **admin** account to start

---

## The script · 2:30

### 0:00 – 0:14 · The problem
*App landing page.*

> "Put an institution's trading on a public blockchain and you publish its order flow, its
> positions and its size — to competitors, and to anyone who wants to trade ahead of it.
> TradeLayer removes that exposure without handing trust to a server."

### 0:14 – 0:34 · Found a firm, fund a treasury
*Create an institution → "NORTHWIND CAPITAL" → sign. Then fund with 25 USDC.*

> "Anyone can found an institution — this is happening live, on Hedera testnet, right now. It gets
> one pooled treasury in Circle's USDC. Not a token we minted: Circle's, used as-is."

*Terminal shows `institution "NORTHWIND CAPITAL" registered` and `treasury funded with 25.0 USDC`.*

### 0:34 – 0:52 · Membership takes two signatures
*Switch MetaMask to the employee → "Ask to join". Switch back to admin → Approve.*

> "Membership needs both sides. The employee proposes from their own wallet, the admin approves
> from theirs. A wallet belongs to exactly one institution — which is what makes it **impossible**
> for one firm to touch another firm's people, rather than merely against the rules."

### 0:52 – 1:08 · Compliance lives in the token — *tabs 4 and 5*
*Click Admit. Then HashScan TSLA-t, then the ATS studio.*

> "Admitting someone isn't a flag in our database. It's written into the **equity token itself** —
> issued through Hedera's Asset Tokenization Studio, with KYC and a control list built in."

*Tab 5 — the ATS studio:*

> "This is Hedera's own app, not ours. Suspend someone here and the token refuses them. We're not
> in the loop."

### 1:08 – 1:22 · The private rulebook
*Rules card: limit per order, who may trade, restricted symbols → Seal and publish.*

> "The admin's limits — who trades, how much per order, which stocks are off-limits — are
> encrypted in the browser before they leave it. Checked on every order, and they cannot be read
> back. Not by us. Not even by the admin who wrote them."

### 1:22 – 1:40 · The order
*Switch to the employee wallet. $5 on TSLA. Place sealed order.*

> "This wallet holds **no** company money — check it, it has zero USDC. The escrow draws from the
> firm's treasury directly. Traders get authority, not custody. That's how a real desk works."

### 1:40 – 1:58 · The proof, in the terminal — *full-screen it*

> "The backend receives ciphertext and holds no key that can open it. It says so itself."

*Point at the `intake` block — ephemeral key, nonce, byte count.*

> "It's opened only inside a Chainlink Confidential Workflow on AWS Nitro. Same bytes — readable
> there and nowhere else. It checks the firm's private rules, then places **one real order** at
> Alpaca."

### 1:58 – 2:12 · The fill and the settlement
*Run H2 in the spare terminal:*
`cd cre && cre workflow simulate ./tradelayer --target testnet-settings --trigger-index 1 --non-interactive --allow-insecure-rpc`

> "The market is shut this weekend, so I'm **simulating the fill** — at Tesla's real last traded
> price. Everything past that line is real."

*Terminal: `SIMULATED FILL … using the real last trade for TSLA: $365.485`, then the settlement.*

> "Shares credited and escrow released in **one signed authorization** — they cannot come apart.
> The position is written back encrypted. Five USDC left the treasury; the firm now holds
> 0.0136 of a Tesla share, and only this employee can read that."

### 2:12 – 2:22 · What the chain shows, and what it doesn't — *tab 8*
*Paste the transaction URL from `proofLinks.ts`. Scroll to the event log.*

> "Here's that order on Hedera. Everything public about it is an amount and a deadline. Not the
> stock, not the share count, not the price, not who benefits."

*Then the schedule link.*

> "And the refund is already scheduled on-chain to fire at the deadline. If nothing fills, the
> money goes back to the treasury on its own — no keeper, no operator, nobody to trust."

### 2:22 – 2:28 · The same order at the broker — *tab 6*
*Search the `client_order_id` from `proofLinks.ts`.*

> "The same order at Alpaca — placed for real, and still queued, because the market is closed.
> That identifier is the first half of the on-chain order id, so you can carry an ID off the
> blockchain straight into the broker and find the same trade."

### 2:28 – 2:30 · Close — *tab 7*

> "Deployed and live on Chainlink's network. Nothing here is a mock."

---

## What the terminal shows

From a real run today — this is the settled flow, not an illustration:

```
intake   sealed order envelope received id=0x246e90402b…
         ephemeral key  0x037789ec5f8820099bd40b…   (secp256k1, fresh per envelope)
         nonce  70iTV6wQu7SMaz1p    ciphertext  628B    tag  6RqP/4UD454STHu4…
         this process holds no key that can open it — decryption happens only inside the enclave

chain    order opened — 5.0 USDC reserved from the institution's pool
         everything public about this order: amount 5.0 USDC · deadline 6:45:02 PM
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
broker   client_order_id 246e90402bdfcfc0a760dbb7e3ea9309 (a retry cannot buy twice)
broker   Alpaca responded — id 45a6f584-93f7-40f0-b208-edd8c630c7d2
broker     status accepted · filled_qty 0

enclave  H1: placed; ledger v4 relay confirmed
chain    encrypted position written — version 4

── then H2 ─────────────────────────────────────────────────────────────────────
enclave  H2: 1 open order(s)
broker   ⚠ SIMULATED FILL — the market is closed, so Alpaca has not filled this order
broker     using the real last trade for TSLA: $365.485
broker     pretending: filled_qty 0.013680452 · avg $365.485 · notional $5.00
broker     everything downstream of this line is real — settlement, escrow, ledger
enclave  H2: filled 0.013680452 TSLA @ $365.485 — settling $5.00 atomically:
             shares credited ⇔ escrow released
enclave  H2: settlement confirmed; encrypted position now v5
chain    order SETTLED — 5.0 USDC spent, 0.0 USDC returned to the pool
chain    encrypted position written — version 5
```

Decrypted afterwards with the employee's own key — and only with it:

```
PUBLIC    ledger entry v5, 873 bytes of ciphertext
          → symbol, quantity, price, position: NOT VISIBLE ANYWHERE ABOVE
PRIVATE   positions  {"TSLA":"0.013680452"}
          stranger decrypt  correctly rejected
```

**The two lines to point at:** `this process holds no key that can open it`, then
`envelope opened — {"symbol":"TSLA"…}`. The same bytes, opaque in one process and readable in the
next, with Chainlink's own disclaimer between them. That is the whole architecture on one screen.

---

## Everything a judge can verify — all confirmed live today

| Claim | Where they check it |
|---|---|
| Contracts are real and verified | HashScan; Sourcify `exact_match` on all five |
| The order hit the chain | `hashscan.io/testnet/transaction/…` from `proofLinks.ts` |
| Only amount + deadline are public | the `OrderOpened` event log on that transaction |
| The refund needs no keeper | `hashscan.io/testnet/schedule/0.0.…` — *wait for expiry*, unexecuted |
| Equities are genuine ATS tokens | TSLA-t `0.0.10494983` · FORD-t `0.0.10494829` · VOO-t `0.0.10495021` |
| Settlement is Circle's USDC | `0.0.429274` — "USD Coin", treasury `0.0.5176` |
| The broker order is real | the order id in the Alpaca dashboard |
| Chain and broker are the *same* order | `client_order_id` = first 32 hex of the on-chain order id |
| The workflow is deployed | `app.chain.link/cre/workflows`, id `0009ba3e…469e`, ACTIVE |
| Cross-firm attack is impossible | `forge test --match-test test_rivalInstitutionCannotFreezeYourEmployee -vv` |

## Say these, don't hide them

- The market is closed. The **order** is real and queued at Alpaca; the **fill** is simulated at the
  real last price so the settlement path can be shown. Everything after the fill — settlement,
  escrow release, encrypted position — is a genuine on-chain transaction.
- H3 will **not** mint the equity tokens against a simulated fill: it compares on-chain supply with
  the broker's actual positions, and Alpaca holds none. The reserve check is doing its job. If
  asked, that is a good answer, not a gap.
- The enclave runs locally through `cre workflow simulate` — same compiled WASM, same handlers.
  The workflow **is** deployed on CRE; confidential-HTTP consensus is a beta limitation we hit and
  reported to Chainlink.
- The escrow leaks order size: an amount is visible even though the symbol is not.

## If something goes wrong mid-take

| Symptom | Cause | Fix |
|---|---|---|
| UI can't reach the service | vite moved to 8081 | free 8080, restart `yarn start` |
| Progress card sits on "Opened privately" | enclave still running (20–30 s) | wait; it says "about half a minute" after 12 s |
| "That name is already taken" | you registered it in a rehearsal | use `MERIDIAN CAPITAL` |
| A write silently does nothing | double-clicked; nonce collision | wait 30 s, retry once |
| No `pre-trade check PASSED` line | rules weren't published first | publish the rulebook, then re-order |
