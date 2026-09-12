# The problem

Blockchains are made of glass.

Put an institution's trading on a public chain and you publish three things at once:

- **Its order flow.** Every intent, in the open, before it executes.
- **Its positions.** What it holds, in what size.
- **Its balance sheet.** How much capital it has to deploy.

To competitors. To anyone running a front-running bot. To anyone curious.

For a trading desk this is not an inconvenience to be weighed against the benefits of
settlement finality — it is a reason not to use the technology at all. A fund that telegraphs
its accumulation gets front-run out of its own thesis.

## The usual fix moves the problem

The standard answer is a trusted server: keep the sensitive data off-chain in a database the
operator controls, and publish only hashes or aggregates.

That works, and it relocates the trust rather than removing it. Now a single operator sees every
order, every position and every balance. The institution has swapped "everyone can see it" for
"one company can see it, and I have to believe their policy". For a regulated desk that is often a
worse answer, not a better one, because it introduces a counterparty with no fiduciary duty and no
audit trail.

## What is actually needed

Three properties, together:

1. **Confidential execution** — orders are opened and evaluated somewhere that neither the chain
   nor the operator can read.
2. **Verifiable settlement** — the resulting state change is provable on-chain, so nobody has to
   take the operator's word for it.
3. **No new trusted party** — the thing doing the confidential work must be attestable, not
   merely promised.

A hardware-attested enclave supplies the first, EIP-712 signatures verified on-chain supply the
second, and Chainlink's Vault DON releasing secrets *only* to an attested enclave supplies the
third.

That is the whole design. Everything in [Three ideas](three-ideas.md) follows from it.

## What this does not solve

Confidentiality covers data, not logic — the workflow code is public, and it should be. And a TEE
is a hardware trust assumption, not a mathematical one. See [Trust model](trust-model.md) for
where the boundary actually sits, and [Honest limits](../limits.md) for what still leaks.
