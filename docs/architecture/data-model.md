# Data model

Four shapes carry everything.

## Intent

Plaintext. Exists only on the device and inside the enclave.

```json
{
  "v": 1,
  "orderId": "0x…",
  "account": "0x…",
  "orgId": "0x…",
  "side": "BUY",
  "symbol": "TSLA",
  "maxSpend": "5000000",
  "expiry": 1789230185,
  "nonce": 1789222955,
  "userPubKey": "0x02…",
  "sig": "0x…"
}
```

- `sig` is an EIP-712 signature over every other field, domain `TradeLayerIntent`.
- `maxSpend` is in USDC base units (6 dp). Orders are placed **by amount**, not share count.
- `orgId` is **informational only** — H1 re-resolves the real institution from the registry.
- `nonce` must strictly exceed the portfolio's stored nonce, which is the replay guard.

## Sealed envelope

```json
{ "epk": "0x02…", "iv": "…", "ct": "…", "tag": "…" }
```

ECIES over secp256k1 to `INTENT_PUBKEY`, with an AES-256-GCM payload. The ephemeral key is fresh
per envelope.

`commit = keccak256(ct)` is written into `OrderEscrow` at `openBuy`, binding the on-chain order to
exactly this sealed intent. H1 recomputes it and rejects a mismatch — so the envelope handed to
the enclave must be the one the escrow was opened against.

## Portfolio blob

Stored twice in `ConfidentialLedger`, under two different keys, for two different readers.

```json
{
  "cash": "0",
  "positions": { "TSLA": { "qty": "13680452", "locked": "0" } },
  "openOrders": {
    "0x…": { "side": "BUY", "symbol": "TSLA", "notional": "5000000",
             "escrow": "5000000", "brokerOrderId": "…", "placedAt": 1789222955 }
  },
  "nonce": 1789222955,
  "userPubKey": "0x02…"
}
```

- `enclaveBlob` — AES-256-GCM under `k_account = HKDF(LEDGER_MASTER_KEY, accountId)`.
- `userBlob` — ECIES to the employee's own public key, derived from a wallet signature over the
  fixed string `TradeLayer portfolio key v1`.

Share quantities are **9-decimal base units**, matching the ATS equities' precision, so a
fractional position tracks exactly rather than drifting by dust each batch.

## Policy blob

```json
{
  "employees": {
    "0x…": { "canBuy": true, "canSell": true, "restricted": ["VOO"] }
  },
  "maxOrderNotional": "100000000",
  "allowWithdrawShares": false
}
```

Encrypted under `orgKey = HKDF(LEDGER_MASTER_KEY, orgId)`, written only through an admin-signed
policy intent processed by H4, which proves authorship against `registry.adminOf` before
accepting it.

Because the key derives from the ledger master key, **the admin cannot read their own rulebook
back from the chain.** Publishing replaces it wholesale.

## Identifiers

| | Derivation |
|---|---|
| `accountId` | `keccak256(abi.encodePacked(address))` |
| `orderId` | client-chosen bytes32; must match the on-chain escrow |
| `orgId` | `bytes32` of the institution's name, ASCII-padded |
| `client_order_id` | the **first 32 hex characters** of `orderId` |

That last one is load-bearing for verification: Alpaca caps `client_order_id` at 48 characters, so
H1 sends a truncation of the on-chain order id. It is derived identically when placing (H1) and
polling (H2), which keeps the broker itself the idempotency barrier against a duplicate buy — and
it means an identifier taken from HashScan can be pasted into Alpaca to find the same order.
