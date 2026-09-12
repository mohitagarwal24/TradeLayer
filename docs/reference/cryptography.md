# Cryptography

Everything here is pinned by `cre/tradelayer/src/crypto.test.ts` — 13 vectors shared between the
enclave and the browser. If a vector breaks, the two sides have drifted and orders will silently
fail to open.

## Sealing an intent

ECIES over secp256k1 to `INTENT_PUBKEY`:

1. Generate an ephemeral keypair, fresh per envelope.
2. ECDH against the enclave's public key.
3. HKDF-SHA256 the shared secret to an AES-256 key.
4. AES-256-GCM the intent JSON.
5. Emit `{ epk, iv, ct, tag }`.

`commit = keccak256(ct)` goes on-chain at `openBuy` and binds the order to exactly this envelope.

## Key derivation

| Key | Derivation |
|---|---|
| `k_account` | `HKDF(LEDGER_MASTER_KEY, accountId)` — the enclave's view of a portfolio |
| `orgKey` | `HKDF(LEDGER_MASTER_KEY, orgId)` — the policy blob |
| portfolio key | derived from a wallet signature over `TradeLayer portfolio key v1` |

The portfolio key is the reason an employee can read their own position without the enclave and
without trusting the operator: the wallet signature is deterministic, so the same wallet always
derives the same key, and nobody else can produce that signature.

One vector exists specifically because both H1 and H4 rely on it: **`orgKey` derives identically
whether the id arrives as text or as `bytes32`.**

## EIP-712 domains

Two, deliberately distinct.

| Domain | Verifying contract | Used for |
|---|---|---|
| `TradeLayer` / `1` | the contract being called | every enclave→chain authorization |
| `TradeLayerIntent` / `1` | **the vault** | user intents and admin policy intents |

Policy intents sign under `TradeLayerIntent` with the **vault** as verifying contract, so an order
signature can never be replayed as a policy signature. Different struct, different domain, no
overlap.

## Things that must change together

Drift here is silent and expensive, so these sets move as one:

- **TYPEHASH constants** — `packages/foundry/contracts/*` ⇄ `cre/tradelayer/src/crypto.ts` ⇄
  `backend/src/eip712.ts`.
- **Wire crypto** — `cre/tradelayer/src/crypto.ts` ⇄ `packages/nextjs/src/lib/seal.ts`: the ECIES
  info strings, the blob layouts, the portfolio-key recipe, `policyHash`.
- **Authorization payloads** — `cre/tradelayer/src/relay.ts` ⇄ `backend/src/eip712.ts` ⇄
  `backend/src/relayer.ts` `buildCall`.
- **ABIs** — `backend/src/abis.ts`, `cre/tradelayer/src/hedera.ts` and
  `packages/nextjs/src/lib/tradelayer.ts` are hand-written and minimal. The frontend gets contract
  *addresses* from `/health` at runtime, so there is no generated address file to keep in sync.

## Units

| | Precision |
|---|---|
| USDC | 6 decimals |
| ATS equities | 9 decimals |
| Broker notional | decimal dollars, `$1` minimum |

Orders are placed **by amount**, not share count — Alpaca `notional`. That removes the need to
over-reserve against a moving price, and with it the gapped-fill case where the vault absorbed an
overage: `spent` is simply what the broker charged.

`costOfFill` rounds **up to the cent**, so the escrow is never short.

## The gateway JWT

Triggering a deployed workflow needs a JWT the CRE gateway accepts. It is not a standard JWS:

- header `{ "alg": "ETH", "typ": "JWT" }`
- payload `{ digest, iss, iat, exp: iat + 300, jti }`
- `digest` is SHA-256 over the request body with **keys sorted at every nesting level**
- the signature is EIP-191 (`personal_sign`) over `base64url(header).base64url(payload)`
- the recovery byte is normalised from ethers' 27/28 down to **0/1**

Every one of those fails identically in production — the gateway just answers `unauthorized` — so
`backend/scripts/checkGatewayJwt.ts` pins the wire format with 15 checks, including that a
tampered body stops matching the signed digest.
