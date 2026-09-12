# Three ideas

Most of the codebase follows from three decisions. If you understand these, the contracts stop
looking arbitrary.

## 1. No token of our own

Settlement is **Circle's USDC**, used as-is. There is no per-institution currency, no wrapper, no
minting.

This was not always true. Earlier revisions of the architecture had a platform settlement token
(`PlatformUSD`), and before that a per-institution one. Both were removed, for the same reason:

> A labelled balance publishes exactly how much capital a firm has on the platform.

If each institution held `ACME-USD`, then `balanceOf(acme)` is a public number that says how big
ACME is. Even a single shared platform token is worse than raw USDC, because it adds a
peg-integrity trust assumption for no privacy gain.

So `OmnibusVault` holds **one undifferentiated USDC pool**, and who owns what within it exists
only as the encrypted `cash` field in `ConfidentialLedger`. There is deliberately no
per-institution balance anywhere on-chain — which is why the API exposes platform-wide pool
totals and nothing finer.

The equities are the same shape: **one token per stock**, shared by every institution, minted in
net batches so that unrelated trades cancel out.

## 2. Authority, not custody

An employee never holds company money.

`OrderEscrow.openBuy` draws from the institution's pooled treasury, and every exit path —
settlement, cancellation, expiry refund — returns funds there. The employee's wallet is never the
payer and never the recipient. It signs intents; it does not hold capital.

Limits live in an encrypted policy blob and are enforced **inside the enclave, before the order
reaches the market**. This is deliberately the same shape as a trading desk's pre-trade risk
check, and it mirrors how capital actually works at a real firm: traders are given risk limits,
not a wallet.

This is also why the employee wallet in any demo holds zero USDC and still places real orders.

## 3. Membership takes two signatures

`OrgWalletRegistry` binds a wallet to an institution only after **both** sides consent:

```
employee wallet →  proposeJoin(orgId)     signed by the wallet's own key
institution     →  approveJoin(wallet)    signed by the admin
```

Neither alone does anything. A wallet cannot be conscripted into an institution it never asked to
join, and an institution cannot be joined by someone it never approved.

Every compliance action then routes through `ComplianceRouter`, which refuses unless the registry
says the target belongs to the caller's institution:

```solidity
bytes32 callerOrg = registry.orgOf(msg.sender);
if (callerOrg == bytes32(0) || registry.adminOf(callerOrg) != msg.sender) revert NotOrgAdmin(msg.sender);
orgId = registry.orgOf(wallet);
if (orgId != callerOrg) revert NotYourWallet(wallet, orgId, callerOrg);
```

That is what makes *"institution B freezes institution A's employee"* **impossible** rather than
merely discouraged. Twelve of the contract tests exist to prove it.

### One wallet, one institution

`orgOf` is single-valued, and an admin cannot be revoked (`revokeMembership` explicitly refuses
if the target is the org's admin). Consequences worth knowing:

- A wallet cannot belong to two institutions at once. It can *move* — the admin revokes, then it
  proposes elsewhere — but never hold two memberships.
- Registering an institution binds the caller **permanently**. That wallet can never register
  another one.

The single-valued mapping is precisely what makes idea 3 airtight, so this is a deliberate
trade-off rather than a missing feature.
