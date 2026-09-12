# Contracts

Five contracts, all in `packages/foundry/contracts`, all verified on HashScan
(Sourcify `exact_match`). 87 Foundry tests.

## OrgWalletRegistry

The single source of truth for wallet ↔ institution.

```solidity
registerOrg(bytes32 orgId)      // permissionless; caller becomes admin *and* member
proposeJoin(bytes32 orgId)      // the wallet consents, with its own key
approveJoin(address wallet)     // the admin consents; only now is orgOf set
revokeMembership(address)       // admin only — and never the admin themselves
transferOrgAdmin(bytes32, address)
orgOf(address) → bytes32
adminOf(bytes32) → address
```

`PLATFORM` is a reserved orgId for infrastructure accounts (the vault and the escrow), bound by
the owner at deploy, bypassing mutual consent because there is no external counterparty.

Two properties that follow from the implementation and matter in practice:

- **`registerOrg` binds the caller permanently.** `revokeMembership` refuses when the target is
  the org's admin, so an admin wallet can never register a second institution.
- **`proposeJoin` refuses** from a wallet already approved elsewhere. One membership at a time.

## ComplianceRouter

Holds `KYC` / `CONTROL_LIST` / `FREEZE_MANAGER` on the equity tokens. Institution admins never
hold those roles directly — they ask the router, and the router checks the registry first.

```solidity
admitMember(address wallet)              // grants KYC + control-list on every registered symbol
revokeMember(address wallet)
setMemberFrozen(address wallet, bool)
emergencyFreeze(address, bytes reason)   // owner only — a distinct, higher-friction path
statusOf(bytes32 symbol, address) → (bool kyc, bool listed, bool frozen)
```

Every mutating call goes through `_requireOwnWallet`, which is the guard that makes cross-institution
interference impossible. See [Three ideas](../concepts/three-ideas.md#3-membership-takes-two-signatures).

Two ATS details the router exists to absorb:

- `grantKyc`'s **`issuer` argument** must be a registered SSI issuer on the diamond — it is the
  argument that is checked, not the caller. `ComplianceRouter.atsIssuer` holds that address.
- Re-granting KYC or re-listing an account **reverts upstream**, so the router checks current
  status before writing.

## OmnibusVault

One pooled USDC reserve, plus every equity.

```solidity
deposit(uint256 amount)                      // orgId resolved from the registry
fundEscrow(bytes32 orderId, uint256)
releaseEscrow(bytes32 orderId, uint256, uint256)
mintAts / burnAts / transferAts              // net batches, enclave-signed
payout(bytes32 orgId, address, uint256, uint256, bytes)
available() → uint256                        // balance − committed
reserve()   → uint256                        // balance + committed
```

`available()` and `reserve()` are **platform-wide**. There is deliberately no per-institution
balance on-chain; that number exists only as ciphertext in the ledger.

## OrderEscrow

The order state machine: `NONE → OPEN → SETTLED | CANCELLED | REFUNDED`.

`Order.orgId` is resolved from the registry at `openBuy` and stored — it is never taken from the
user-supplied intent. `openBuy` draws from the vault; every exit path returns funds there.

### The refund buffer

```solidity
/// @dev The scheduled refund is registered for this long *after* `expiry`.
/// Scheduling it exactly at `expiry` races this contract's own `block.timestamp < expiry`
/// check... Observed on testnet: a schedule fired at expiry and came back
/// CONTRACT_REVERT_EXECUTED, while the identical call seconds later succeeded.
uint64 public constant REFUND_SCHEDULE_BUFFER = 30 seconds;
```

This is a real bug found on testnet, not a theoretical guard. A one-second boundary between the
HIP-1215 schedule firing and the contract's own expiry check made the self-refund silently fail.

`OrderEscrow` must hold HBAR — the scheduling contract pays for its own HIP-1215 calls.

## ConfidentialLedger

The only place any balance or rule exists.

```solidity
update(bytes32 accountId, bytes enclaveBlob, bytes userBlob, uint64 expectedVersion, bytes sig)
setPolicy(bytes32 orgId, bytes blob, uint64 expectedVersion, bytes sig)
entry(bytes32 accountId) → (bytes, bytes, uint64, bytes32)
policy(bytes32 orgId) → (bytes, uint64)
```

Optimistic concurrency via `expectedVersion`: two writes racing the same account means one fails
with `VersionMismatch` rather than silently clobbering.

Two blobs per entry, deliberately:

- `enclaveBlob` — AES-256-GCM under a key HKDF-derived from `LEDGER_MASTER_KEY`, readable by the
  enclave.
- `userBlob` — ECIES to the user's own public key, so an employee reads their own position
  without the enclave's help and without trusting the operator.

## EnclaveAuth

The shared base. Every mutating entry point across the vault, escrow and ledger carries an
enclave signature, and `_consume` verifies it and burns the digest so it cannot be replayed. This
is the mechanism that makes the relayer unable to forge.
