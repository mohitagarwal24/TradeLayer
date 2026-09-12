# Deployed addresses

Hedera testnet (chain **296**). All five contracts verified on HashScan, Sourcify `exact_match`.

## Contracts

| | Address | Entity |
|---|---|---|
| `OrgWalletRegistry` | [`0xa85a68C09d87189B562864C77BBBbc28110ae6D9`](https://hashscan.io/testnet/contract/0xa85a68C09d87189B562864C77BBBbc28110ae6D9) | `0.0.10495115` |
| `ComplianceRouter` | [`0x6b7f8B75120f1F6CaeCc242581cAc99B07d05D3E`](https://hashscan.io/testnet/contract/0x6b7f8B75120f1F6CaeCc242581cAc99B07d05D3E) | `0.0.10495126` |
| `OmnibusVault` | [`0xdF6852804c867068271df32a32114c62b322Fed3`](https://hashscan.io/testnet/contract/0xdF6852804c867068271df32a32114c62b322Fed3) | `0.0.10495120` |
| `OrderEscrow` | [`0x4F59e014AEDe86A5dcf2422a45cFf82a2fC5eda9`](https://hashscan.io/testnet/contract/0x4F59e014AEDe86A5dcf2422a45cFf82a2fC5eda9) | `0.0.10497882` |
| `ConfidentialLedger` | [`0x458B9b009E291c5869E3d3d56709237a42e8d3b5`](https://hashscan.io/testnet/contract/0x458B9b009E291c5869E3d3d56709237a42e8d3b5) | `0.0.10495117` |

## Tokenised equities

Issued through Hedera's [Asset Tokenization Studio](https://tokenization-studio.hedera.com/),
9 decimals, approval list and internal KYC enabled.

| | Address | Entity |
|---|---|---|
| `FORD-t` | `0x3ca9772d1030cb74fc0b639338241105577524ed` | `0.0.10494829` |
| `TSLA-t` | `0xd085bdb088940ece20a7ccfc064deb2824433249` | `0.0.10494983` |
| `VOO-t` | `0x4761355322501c098d3b0dc9b9cbbfc2d77b766a` | `0.0.10495021` |

## Settlement asset

| | |
|---|---|
| USDC | [`0.0.429274`](https://hashscan.io/testnet/token/0.0.429274) — Circle's own testnet USDC, 6 decimals |

We deliberately issue **no HTS token of our own**. Compliance belongs on the securities, which is
where ATS puts it; the cash leg is Circle's and we hold no keys over it.

## Workflow

| | |
|---|---|
| Workflow ID | `0009ba3eb7bc81d5ecea0661b377cba10e823d9c3d3c933725b1049b2f62469e` |
| Registry | private |
| DON family | `zone-a` |
| Gateway | `https://01.gateway.zone-a.cre.chain.link` |

## Verifying a transaction yourself

Anything the system does is checkable without trusting the operator:

| Claim | Where |
|---|---|
| The order reached the chain | `hashscan.io/testnet/transaction/<hash>` |
| Only an amount and a deadline are public | the `OrderOpened` event log on that transaction |
| The refund needs no keeper | `hashscan.io/testnet/schedule/<id>` — *wait for expiry*, unexecuted |
| The broker order is real | the Alpaca dashboard |
| The chain and the broker are the **same** order | `client_order_id` is the first 32 hex of the on-chain `orderId` |
| One institution cannot touch another's people | `forge test --match-test test_rivalInstitutionCannotFreezeYourEmployee -vv` |

## Note on addresses changing

`OrderEscrow` was redeployed once, to add `REFUND_SCHEDULE_BUFFER`. Replacing it requires
`ledger.setEscrow`, `vault.setEscrow`, `registry.bindPlatformAccount`, funding it with HBAR for
HIP-1215 scheduling, and re-running `yarn ats:setup-hedera` to associate the new address with
USDC. Addresses live in four places that must move together: `cre/tradelayer/config/config.testnet.json`,
`backend/.env`, `packages/ats/.env` and `packages/foundry/.env`.
