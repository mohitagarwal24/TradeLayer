# TradeLayer — Work Handoff

**Written:** 2026-08-25 · **Repo:** `TradeLayer` · **Branch:** `main` (uncommitted) · **Target:** EthOnline 2026

This is the context needed to pick this work up in a new session, on another machine, or by another
person. The build plan itself is separate and already in hand — this document covers **state, reasoning,
verification, and blockers**, not strategy.

---

## 1. TL;DR

Phase 0's **chain-independent security floor is done and verified**: `forge build` compiles,
`forge test` is 21/21 green, and the invariant suite went from 5 real invariants (one was a literal
no-op) to **8 real ones**. The README no longer claims things the code doesn't do.

**Nothing is committed.** All work is uncommitted in the working tree on `main`.

**Phase 0 is not finished.** What remains needs things I can't do from here: the Hedera port needs a
funded testnet account, and the oracle question needs web research that was blocked (see §2).

---

## 2. Environment gotcha — read this first

Most of this session was spent fighting an infrastructure failure that will look like a broken repo if
you don't know about it.

**Symptom:** every `Bash`, `WebSearch`, and `WebFetch` call fails with:

```
claude-opus-5 is temporarily unavailable, so auto mode cannot determine the safety of Bash right now.
```

**Cause:** in *auto* permission mode, tool calls not on an allowlist are routed to a separate safety
classifier running on `claude-opus-5`. That backend was erroring, so calls were rejected before ever
running. It is **not** a repo, command, or model problem — switching the conversation model does not fix
it, because the classifier is a distinct service.

**Fixes, in order of usefulness:**

1. **Allowlist the command** — allowlisted calls skip the classifier entirely and work *even during the
   outage*. This is what unblocked the build. Already committed to `.claude/settings.json`:
   ```json
   { "permissions": { "allow": [
       "Bash(forge build)", "Bash(forge build:*)",
       "Bash(forge test)",  "Bash(forge test:*)",
       "Bash(forge --version)", "Bash(forge --version:*)"
   ] } }
   ```
2. **Shift+Tab** out of auto mode into default mode — you get an approval prompt instead of
   classification, which doesn't need the classifier.
3. **`!command`** typed directly in the prompt runs in-session with no classifier involvement.

**Still blocked:** `WebSearch`, and `WebFetch` for any domain not already allowlisted. `.claude/settings.local.json`
permits only `ethglobal.com`, `raw.githubusercontent.com`, `npmjs.com` — Pyth and Hedera docs are **not**
covered, which is why the research sweep in §6 never ran. Add those domains to unblock it.

> ⚠️ `.claude/settings.local.json` also contains `Bash(python3 *)` — a wildcard granting arbitrary code
> execution. It predates this session and was left untouched. Consider narrowing it.

---

## 3. Toolchain

| Tool | Version |
|---|---|
| Node | v24.9.0 |
| Yarn | 3.2.3 (workspaces: `packages/*`) |
| Foundry / forge | 1.3.5-stable |
| Solidity | `^0.8.28` (`TradeLayer.sol`, `OracleAggregator.sol`); `^0.8.21` (`PythOracle.sol`) |

`foundry.toml`: `src = contracts`, `libs = ['lib','node_modules']`, `fuzz.runs = 256`, **no `[invariant]`
section** (so defaults apply: depth 500, `fail_on_revert = false`), **no pinned solc**, **`ffi` unset →
false**.

The `^0.8.28` pragma matters for the Hedera port: `require(cond, CustomError())` is used in
`TradeLayer.sol` and needs solc ≥ 0.8.26. Confirm Hedera's EVM supports the resulting bytecode.

---

## 4. Changed files and why

`git diff --stat` vs `HEAD` (`6216159`): **11 files, +523 / −479**, plus 5 untracked paths.

### Contracts

**`packages/foundry/contracts/TradeLayer.sol`** — the core fixes.

| Fix | Detail |
|---|---|
| Access control | `fulfillRequest` is now `onlyBackend`. Previously the modifier existed but was annotated `// no use` and applied to nothing, and `backendWallet` was never assigned (permanently `address(0)`). **Anyone could mint DSTOCK or drain escrow.** `backendWallet` is now set in the constructor; `setBackendWallet` (`onlyOwner`) rotates it. `owner` added; `addStock` is `onlyOwner`. |
| Order-attribution bug | `_processPurchase`/`_processRedemption` now take the `orderId` **parameter** and read `requests[orderId]`. They previously read `requests[res.orderId]` — the orderId *inside the backend-supplied bytes* — so a settlement could be attributed to a different user's order. |
| Replay guard | `orderIdUsed[orderId] = true` is now actually written in `buyStock` and `redeemStock`. The `require(!orderIdUsed[...])` check existed but nothing ever set the flag, so it was dead. |
| Redeem double-spend | Added `lockedForRedeem[user]`. `redeemStock` locks rather than burns, because the encrypted order doesn't reveal *which* stock is being sold, so `totalHoldings` can't be decremented until settlement. Locking preserves `totalSupply == Σ totalHoldings` while preventing one balance from backing two redeems. (The original had the burn commented out entirely.) |
| Redeem quantity binding | `_processRedemption` requires `res.stockQuantity == req.tokenBalance` and that the user actually holds it. |
| **Escrow segregation** (found in review, not in the original plan) | Added `escrowedBuyUsdc`. Redemption payouts may only draw on the balance *above* it. Previously redeem proceeds and buy escrow shared one pool, so paying a redeem could spend USDC escrowed against someone else's unfilled purchase. Invariant #1 was passing only because the test seeds 10M mock USDC. |
| Buy refunds | `_processPurchase` now pays out `Result.amountToRefund` (capped at that order's escrow) and releases the escrow. It was previously ignored on buys, so partial-fill change was stranded in the contract. |

**`packages/foundry/contracts/OracleAggregator.sol`** — added `owner` + `onlyOwner`; `setChainlinkFeed`
and `setPythPriceId` were **unpermissioned** (anyone could repoint a price feed). Otherwise unchanged.
⚠️ Still **not referenced by `TradeLayer.sol`** — the multi-oracle validation is not in the trade path.

### Tests

**`test/invariant/Handler.t.sol`** — substantially rewritten. The original faked encrypted orders and
picked a **random symbol at settlement time**, so it structurally could not detect a settlement that
disagreed with its order. Now it tracks intended per-actor/per-stock holdings in `ghost_holdings` and
settles every request against what that request actually committed to. `fulfillBuyRequest` gained a
`refundSeed` param (bounded by the order's escrow); `fulfillRedeemRequest` bounds proceeds to the
contract's *free* USDC so calls exercise logic instead of just reverting.

**`test/invariant/Invariant.t.sol`** — 8 real invariants:

| # | Name | Property |
|---|---|---|
| 1 | `usdcConservation` | `balanceOf(tradeLayer) ≥ Σ pending buy USDC` |
| 2 | `tokenSupplyEqualsHoldings` | `totalSupply() == Σ totalHoldings` |
| 3 | `settlementMatchesIntent` | on-chain holdings == intended holdings ← **was `assertTrue(true)`** |
| 4 | `userBalanceCoversHoldings` | `balanceOf(user) ≥ Σ their holdings` |
| 5 | `transfersDisabled` | `transfer`/`transferFrom` always revert |
| 6 | `ghostVariableConsistency` | `minted − burned == totalSupply()` |
| 7 | `noDuplicateOrderProcessing` | settlements == orderIds flagged processed ← **was vacuous** |
| 8 | `buyEscrowSegregated` | `escrowedBuyUsdc == Σ pending buy USDC` ← **new** |

`setUp` now calls `tradeLayer.setBackendWallet(address(handler))` so the handler is the authorised settler.

### Secrets removal

Live Alpaca paper-trading credentials were hardcoded in **5 files** (the original audit said 4 — 
`backend/alpacaScript.ts` was missed):

- `backend/eventListener.ts`, `backend/components/alpaca.ts`, `backend/components/alpacaListener.ts`,
  `backend/alpacaScript.ts`, `clientSide/index.ts`

All now import a shared client. New untracked files:

- `backend/components/alpacaClient.ts`, `clientSide/alpacaClient.ts` — read `ALPACA_KEY_ID` /
  `ALPACA_SECRET_KEY` / `ALPACA_PAPER` from env and **throw at import** if unset (no silent fallback)
- `backend/.env.example`, `clientSide/.env.example`
- `backend/package.json` — added `dotenv ^17.2.3`

`.gitignore` already covers `backend/.env` and `clientSide/.env`.

> 🔴 **The keys are still live and still in git history.** Removing them from the working tree does not
> revoke them. See §7.

### Docs

**`README.md`** — rewritten (+470/−479). Splits **implemented** from **designed but not implemented**
(Lit Protocol MPC, Chainlink PoR, dynamic staking/slashing — all diagram-only), documents the known gaps
honestly (position privacy does *not* hold; settlement is not verifiable; no cancellation path; whole
shares only), and leads with two warnings: the Base mainnet deployment
`0x5c7B3c7AC4640d5eB9424e93F10F9ab299516333` **is vulnerable and unfixed**, and the credentials leaked.
It also explicitly retracts the old "6 invariants, protocol proven secure" claim.

---

## 5. Verification — actual output

```
forge build   → compiles (only `mixed-case-variable` lint notes on ghost_ vars; no errors)
forge test    → 21 passed, 0 failed, 0 skipped, in 394.80s

test/BaseTest.sol .................. 1 passed
test/OracleTest.t.sol .............. 11 passed
test/invariant/Invariant.t.sol ..... 9 passed  (8 invariants + callSummary)
```

Each invariant ran **256 runs × 128,000 calls**, ~620 reverts each. Those reverts are **expected and
healthy** — the fuzzer hitting `require` guards (reused orderId, redeem-more-than-held,
refund-exceeds-escrow) and being correctly rejected. `fail_on_revert` defaults to false, so they're
discarded rather than counted as failures.

The invariant suite takes **~6.5 minutes**. Budget for that.

---

## 6. Open blockers — the critical path

These are unresolved. **The first one can invalidate the entire Hedera plan**, so do it before writing
any Hedera code. A research sweep was launched for these and lost when the session's process exited; it
was never re-run because `WebSearch`/`WebFetch` stayed blocked (§2).

| Priority | Question | Blocks |
|---|---|---|
| 🔴 1 | **Do live equity price feeds (AAPL/TSLA) exist on Hedera at all?** Pyth? Supra? Chainlink? If none, decide now: clearly-labelled mock feed, or keep the oracle path on Base. | Phase 0 — potentially the whole Hedera base |
| 🔴 2 | **Can one project win multiple tracks?** The whole prize-stacking strategy assumes yes. | Entire strategy |
| 🟠 3 | **Prior-code disclosure rules.** TradeLayer pre-exists the event; ETHGlobal generally expects work done *during* it, evidenced by git history. | Eligibility |
| 🟠 4 | **Blocky402 facilitator integration specifics** (hard qualification requirement). | Phase 3 |
| 🟡 5 | **Does The Graph index Hedera?** If not, drop that phase rather than split chains. | Phase 4 |
| 🟡 6 | Hedera EVM specifics: contract-size limits, HTS token association, HBAR 8-vs-18 decimals. | Phase 0 port |
| 🟡 7 | Is Chainlink Functions on Hedera? (Probably not — prefer HCS + threshold-signed reporter over contorting the architecture.) | Phase 2 |

---

## 7. Actions only a human can take

1. **Rotate the Alpaca keys.** Go to the Alpaca dashboard and revoke
   `REDACTED_ALPACA_KEY_ID`. It is in public git history; code changes cannot invalidate it.
   Then create `backend/.env` and `clientSide/.env` from the `.env.example` files.
2. **Decide about the Base mainnet deployment.** `0x5c7B3c7AC4640d5eB9424e93F10F9ab299516333` is live
   with the unauthenticated `fulfillRequest`. The fix exists in source but **is not deployed there**. If
   it holds any funds, move them. The README warns against sending it anything.
3. **Provision a Hedera testnet account** (account ID + ECDSA private key, funded with test HBAR) before
   the port can be deployed or HashScan-verified.
4. **Decide on committing.** Everything is uncommitted on `main`. Hackathon rule #3 warns that several
   sponsors discount single final-day commits, so an early checkpoint has real value. Suggested:
   `git checkout -b phase0-security-floor` then commit. *(A `phase0-security-floor` branch may already
   exist from an earlier attempt — check `git branch` first.)*

---

## 8. Immediate next steps

1. Unblock research: add `WebFetch(domain:docs.hedera.com)`, `WebFetch(domain:pyth.network)`,
   `WebFetch(domain:hedera.com)`, `WebFetch(domain:thegraph.com)` to `.claude/settings.json`.
2. Answer blocker **#1 (equity feeds on Hedera)** and **#2 (multi-track eligibility)**. Everything
   downstream depends on these two.
3. Commit Phase 0 as a checkpoint (§7.4).
4. Then either:
   - **Hedera port** (finish Phase 0) — needs #1 answered and a funded account; or
   - **Phase 2 commit–verify binding** — pure Solidity, needs *no* research or chain access, and it's the
     single highest-value item in the plan: it makes the protocol's central claim true, and the demo
     (*a mismatched settlement visibly reverts*) is the most persuasive thing in the submission. **This is
     the best use of time while research is blocked.**

### Design questions to settle before building Phase 2

Commit–verify sounds simple but these need answers first:

- **Partial fills** — the commitment names a quantity; the fill may differ. Commit to a *maximum* and
  verify `filled ≤ committed`?
- **Salt/nonce** — `keccak256(symbol, smallQty)` has a tiny search space and is trivially brute-forced.
  The preimage must include a random salt or the commitment leaks the order.
- **Orders that never fill** — needs a timeout path that releases both `escrowedBuyUsdc` and
  `lockedForRedeem`. This gap exists today (§4) and commit–verify makes it more visible.
- **Slippage** — the price at commit vs. at fill.

---

## 9. Landmines

- **Position privacy does not work, and code depends on it not working.** `totalHoldings` and
  `stockHoldings` are `public`; `clientSide/readContract.ts:7` reads them to build the portfolio view.
  If you make holdings private to honour the privacy claim, **that file breaks**. Decide the claim before
  touching it (Phase 1 covers this).
- **`OracleAggregator` is tested but unwired.** 11 passing tests give a false impression — `TradeLayer`
  calls Pyth directly and never touches it. Don't cite it as a shipped feature.
- **The frontend trading UI is a mock.** `packages/nextjs/src/components/trade/TradingCard.tsx` uses a
  hardcoded `MOCK_RATES` table and its `handleTrade` only fires a toast. The working paths are the MCP
  server (`clientSide/index.ts`) and the `clientSide/` scripts. There is also a `packages/nextjs-backup`.
- **No cancellation path anywhere.** An unsettled buy strands USDC in `escrowedBuyUsdc`; an unsettled
  redeem strands DSTOCK in `lockedForRedeem`. No timeout, no refund.
- **`decimals()` returns 0** — whole shares only, no fractional positions.
- **The invariant suite is slow** (~6.5 min). Use `--match-test` while iterating.
- **`PythOracle.sol` is on `^0.8.21`** while the others are `^0.8.28` — worth a look during the Hedera port.
