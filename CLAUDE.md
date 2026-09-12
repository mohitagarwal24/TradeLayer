# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## What this is

TradeLayer v2: an **institution** registers on the site, funds a USDC treasury, decides who may
trade and how much, and its people buy tokenised equities on the institution's behalf — without
publishing what they trade or hold. Orders are sealed in the browser and opened only inside a
Chainlink Confidential Workflow (AWS Nitro), which checks the institution's private rules, places
one real Alpaca order, and signs EIP-712 settlements a relayer submits. Positions live encrypted
in `ConfidentialLedger`; shares are ATS equities pooled in `OmnibusVault`.

**Hedera testnet only. No local chain, no mock broker.** The states that matter — queued outside
market hours, partial fills, rejections — only exist against the real chain and the real broker.

> The authoritative architecture is a Notion doc, not this file or the README. See the
> `tradelayer-notion-architecture` memory for how to fetch it; it is ahead of the code more often
> than behind it.

## Three ideas that explain most of the code

1. **No token of our own.** Settlement is Circle's USDC, used as-is. There is no per-institution
   currency and no wrapper. A labelled balance would publish exactly how much capital a firm has
   on the platform, so the vault holds **one undifferentiated pool** and who owns what exists only
   as the encrypted `cash` field in `ConfidentialLedger`.
2. **Authority, not custody.** An employee never holds company money. `openBuy` draws from the
   pool and every exit path returns it there. Limits live in the encrypted policy blob and are
   enforced by the enclave before the order reaches the market — the same shape as a trading
   desk's pre-trade risk check.
3. **Membership takes two signatures.** `OrgWalletRegistry` binds a wallet to an institution only
   after the wallet calls `proposeJoin` *and* the admin calls `approveJoin`. Every compliance
   action is routed through `ComplianceRouter`, which refuses unless the registry says the target
   belongs to the caller's institution. That is what makes "institution B freezes institution A's
   employee" impossible rather than merely discouraged.

## Layout and package managers

| Path | Manager | What |
|---|---|---|
| `packages/foundry` | yarn workspace | Solidity, Foundry tests, `script/Deploy.s.sol` |
| `packages/nextjs` | yarn workspace | **Vite + React** (dir name is SE-2 legacy), port 8080 |
| `packages/ats` | yarn workspace | ATS equity issuance + role wiring |
| `backend/` | **npm** (own lockfile) | Express intake API, relayer, chain narration |
| `cre/` | **bun** | Chainlink CRE TypeScript workflow (`cre/tradelayer`) |

## Contracts

| Contract | Responsibility |
|---|---|
| `OrgWalletRegistry` | wallet ↔ institution, by mutual consent. `PLATFORM` is reserved for the vault and escrow, bound by the owner at deploy. |
| `ComplianceRouter` | holds `KYC` / `CONTROL_LIST` / `FREEZE_MANAGER` on the equities; admins never hold them. Checks the registry before forwarding. |
| `OmnibusVault` | one pooled USDC reserve + every equity. Funds the escrow, mints/burns in net batches. |
| `OrderEscrow` | order state machine. `Order.orgId` is resolved from the registry at `openBuy`. HIP-1215 self-refund. |
| `ConfidentialLedger` | the only place any balance or rule exists, encrypted, with optimistic versions. |

## Commands

```bash
yarn install; (cd backend && npm install); (cd cre/tradelayer && bun install)

yarn deploy:hedera-testnet     # needs PRIVATE_KEY, ENCLAVE_SIGNER, ATS_F/ATS_TSLA/ATS_VOO in packages/foundry/.env
yarn ats:setup-hedera          # associate vault + escrow + operator with USDC
yarn ats:grant-router-roles    # AGENT → vault; KYC/CONTROL_LIST/FREEZE_MANAGER → router
cd backend && npm start        # intake + relayer + chain narration on :8000
yarn start                     # UI on :8080

# headless clients, useful without a browser
cd cre/tradelayer && ADMIN_KEY=… EMPLOYEE_1=0x… bun scripts/setPolicy.ts
cd cre/tradelayer && EMPLOYEE_KEY=… bun scripts/placeOrder.ts TSLA 1
cd cre && cre workflow simulate ./tradelayer --target testnet-settings --trigger-index 1 --non-interactive
```

Checks (nothing runs them all):

```bash
cd packages/foundry && forge test                     # 86 tests
forge build --sizes                                   # all contracts well under 24576 B
cd cre/tradelayer && bun test && bunx tsc --noEmit     # 10 crypto vectors + typecheck
cd cre && cre workflow build ./tradelayer --target testnet-settings --non-interactive
cd backend && npx tsc --noEmit
yarn workspace @tradelayer/ats check-types
yarn frontend:check-types && yarn frontend:lint && yarn frontend:build
```

`cre workflow simulate` / `build` need `cre login` or `CRE_API_KEY`. WSL has Foundry in
`~/.foundry/bin`, Node 20 via nvm, `cre` in `~/.cre/bin`, `bun` in `~/.bun/bin` — none on the
non-interactive PATH.

## The four enclave handlers

Registered in `cre/tradelayer/main.ts`. H1 and H4 **share trigger 0**: a deployed workflow may
register only one HTTP trigger ("no mechanism to route requests to different HTTP trigger handlers
within the same workflow"), so `onHttp` branches on the payload's `kind`. Simulation happily runs
two, which is why this only surfaces at deploy time. The index still matters for `simulate`, which
addresses handlers by number; the gateway has no such concept.

| | Trigger | Inside the enclave |
|---|---|---|
| H1 intake | HTTP **0**, `kind: "order"` | opens the sealed intent, verifies the signature, **takes the institution from `order.orgId`** (see below), decrypts portfolio + rules, places one broker order, signs `LedgerUpdate` |
| H2 reconcile | cron, index 1 | polls fills, signs one atomic `Settlement`. `pending:*` outside market hours is expected, not a failure |
| H3 batch | cron, index 2 | nets fills per symbol across **every** institution, signs `AtsMint`/`AtsBurn` |
| H4 policy | HTTP **0**, `kind: "policy"` | opens the admin's sealed rulebook, proves authorship against `registry.adminOf`, re-encrypts under `orgKey`, signs `PolicyUpdate` |

**Never trust `intent.orgId`.** It is user-supplied. H1 compares it against `order.orgId`, which
the escrow resolved from the registry at open time, and rejects a mismatch. Trusting the intent
field would let someone have their order judged against another institution's rules.

H1 fails **closed** on a policy blob it cannot decrypt: rules that cannot be evaluated are never
treated as rules that passed.

## Things that must change together

- **EIP-712 structs**: `packages/foundry/contracts/*` TYPEHASH constants ⇄ `cre/tradelayer/src/crypto.ts`
  `TYPEHASH` ⇄ `backend/src/eip712.ts` `EIP712_TYPES`. Domain is `TradeLayer` / `1` / chainId /
  contract.
- **Wire crypto**: `cre/tradelayer/src/crypto.ts` ⇄ `packages/nextjs/src/lib/seal.ts` (ECIES info
  strings, blob layouts, portfolio-key recipe, `policyHash`). `crypto.test.ts` pins the vectors —
  including that `orgKey` derives identically whether the id arrives as text or bytes32, which H1
  and H4 both rely on.
- **Policy signing** uses domain `TradeLayerIntent` with the **vault** as verifying contract, so an
  order signature can never be replayed as a policy.
- **Authorization payloads**: `cre/tradelayer/src/relay.ts` ⇄ `backend/src/eip712.ts` ⇄
  `backend/src/relayer.ts` `buildCall`.
- **HTTP payloads**: `backend/src/intake.ts` sets `kind` ⇄ `cre/tradelayer/src/handlers.ts`
  `onHttp` routes on it. Adding a third HTTP-driven handler means another `kind`, not another
  trigger.
- **Gateway JWT**: `backend/src/creGateway.ts` ⇄ the address in `config.testnet.json`
  `authorizedKeys`. `npx tsx scripts/checkGatewayJwt.ts` pins the wire format — the gateway
  rejects every mistake identically, as "unauthorized".
- **ABIs**: `backend/src/abis.ts`, `cre/tradelayer/src/hedera.ts` and
  `packages/nextjs/src/lib/tradelayer.ts` are hand-written minimal ABIs. The frontend gets contract
  **addresses** from the backend's `/health` at runtime — there is no generated address file to
  keep in sync.
- **Addresses**: `cre/tradelayer/config/config.testnet.json`, `backend/.env`, `packages/ats/.env`,
  `packages/foundry/.env`.

## Hedera specifics

- `OmnibusVault` and `OrderEscrow` must each `associate(USDC)` after deployment; only the account
  itself may associate, so `forge script` cannot do it (it simulates where `0x167` doesn't exist).
- `OrderEscrow` must hold HBAR: the scheduling contract pays for its own HIP-1215 calls.
- `grantKyc`'s **`issuer` argument** must be a registered SSI issuer on the diamond — it is the
  argument that is checked, not the caller. `ComplianceRouter.atsIssuer` holds that address.
- Re-granting KYC or re-listing an account reverts upstream, so the router checks before writing.
- `setAddressFrozen` accepts `FREEZE_MANAGER` **or** `AGENT`.
- Hashio: `batchMaxCount: 1`, `staticNetwork: true`. Gas estimates run low — see `RELAY_GAS_LIMIT`.

## Relayer

The enclave signs EIP-712 authorizations; `backend/src/relayer.ts` verifies locally, dedupes by
digest and submits. It can censor but cannot forge — every contract re-verifies via
`EnclaveAuth._consume`. The Notion doc's key-management section describes per-handler Hedera
operator keys instead; that divergence is deliberate and was decided with the user.

A cached "confirmed" receipt is only trusted after checking `usedDigest` on chain: the relay store
outlives chain resets, and ATS batch digests are low-entropy, so a stale receipt would otherwise
silently suppress a real mint.

## Environment files

`packages/foundry/.env`, `backend/.env`, `cre/.env` (the simulator reads `secrets.yaml` names from
it), `packages/ats/.env`, `packages/nextjs` `VITE_BACKEND_URL`. All gitignored; each has a
`.env.example`.
