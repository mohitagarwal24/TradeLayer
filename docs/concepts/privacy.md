# What is private, and from whom

The useful question is not "is it encrypted" but "who can read what". This page answers it
component by component, including the things that do leak.

## What an outside observer sees on-chain

For an order, exactly this:

| Visible | Not visible |
|---|---|
| An amount in USDC | The symbol |
| A deadline | The share count |
| A commitment hash | The price |
| Ciphertext, and its version number | Whose order it is |

Per symbol, the aggregate equity supply moves — but in **net batches** across every institution,
so a single firm's activity is not separable from the total.

## What each party can read

| Party | Can read |
|---|---|
| The chain | ciphertext, amounts, deadlines, version numbers |
| The intake API | the sealed envelope. **It holds no decryption key** |
| The relayer | signed authorizations. It can censor; it cannot forge or read |
| The enclave | everything — intents, portfolios, rules, broker credentials |
| The employee's wallet | its own portfolio, via a separate `userBlob` |
| The institution's admin | nothing it did not write. It **cannot** read back its own published rulebook |

That last row surprises people. The policy blob is encrypted under a key derived from the ledger
master key, which lives in the Vault DON. The admin who wrote the rules cannot decrypt them from
the chain — publishing replaces the rulebook wholesale rather than editing it.

## Why batching exists

The enclave could settle each trade the instant it fills. If it did, an observer could watch the
vault's `TSLA-t` balance change by exactly the fill quantity at exactly the fill moment, and line
that up against a public escrow release of a known amount — recovering both the symbol and the
price.

So handler **H3** runs on a timer, nets every fill per symbol **across all institutions**, and
mints or burns only the difference. Unrelated trades cancel. The escrow lock earlier in the flow
is real-time; only settlement is batched.

Batching hides individual fills **at volume**. With one institution and one trade in a window,
netting has nothing to net against. The guarantee that holds regardless of volume is different and
stronger:

> **Hidden until filled.** An order cannot be front-run, because nothing readable exists before
> execution.

## What leaks

Stated plainly, because a privacy claim with an asterisk you have to find is worth nothing.

- **The escrow leaks order size.** Locking an exact amount is visible even though the symbol is
  not. A large lock says a large order. The intended fix is a pre-funded float, not yet built.
- **Ciphertext length correlates with plaintext length.** AES-GCM is a stream mode, so a 628-byte
  envelope tells you something about the intent's size. In practice this is weak — the amount is
  already public — but it is not nothing.
- **Timing is visible.** When an order opens and settles is public, even if its content is not.
- **The workflow code is public.** Confidentiality covers data, not logic. This is correct and
  deliberate: you should be able to read what the enclave will do with your order.

See [Honest limits](../limits.md) for the rest.
