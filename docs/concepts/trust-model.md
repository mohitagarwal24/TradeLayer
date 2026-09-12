# Trust model

What each party can do, what it cannot, and what you are actually trusting.

## The enclave holds the only keys that matter

| Secret | What it opens |
|---|---|
| `INTENT_PRIVKEY` | sealed order envelopes |
| `LEDGER_MASTER_KEY` | every portfolio and policy blob (per-account keys are HKDF-derived from it) |
| `ENCLAVE_SIGNING_KEY` | signs the EIP-712 authorizations the contracts accept |
| `ALPACA_KEY_ID` / `ALPACA_SECRET_KEY` | the broker account |
| `RELAY_AUTH_TOKEN` | the relayer's gas-spend guard |

All are Vault DON secrets, released **only to an attested enclave**, fetched inside
`handlerInTee`, and never written to disk.

## What the relayer can and cannot do

The relayer holds a hot Hedera key and submits transactions. It is the only path from the enclave
to the chain, which makes its limits worth stating precisely.

**It cannot forge.** Every state change is an EIP-712 struct the enclave signed. Each contract
re-verifies the signature through `EnclaveAuth._consume` and rejects anything else. A malicious
relayer submitting its own settlement gets a revert.

**It cannot read.** It sees signed authorizations — blobs and amounts — never plaintext.

**It can censor.** It can refuse to submit. This is a real limitation, and the mitigation is
structural rather than cryptographic: every order carries an on-chain, self-executing HIP-1215
refund that fires at expiry without any keeper, operator or relayer involvement. A censoring
relayer can stall you; it cannot strand your money.

## What the intake API can and cannot do

It receives sealed envelopes and hands them to the enclave. It holds no decryption key — this is
not a policy, it is a fact about which keys exist where. Its log says so on every order, because
the claim is only worth anything if you can watch it being true.

It **can** censor an order by refusing to forward it. Same shape as the relayer, same mitigation.

## What you are trusting

Honestly, in order of weight:

1. **AWS Nitro attestation.** That the enclave is running the code it claims to be running, and
   that AWS's attestation is sound. This is a *hardware* trust assumption, not a mathematical one.
   We say hardware-attested and trust-minimised, never trustless.
2. **The Chainlink Vault DON.** That it releases secrets only against a valid attestation.
3. **The workflow code.** Which is public, and which you should read.
4. **Circle**, for USDC, exactly as every USDC holder already does.

What you are **not** trusting: the operator of this project, the relayer's honesty, or the intake
API's discretion. None of them can read an order, and none can forge a settlement.

## Divergence from the specification

The Notion architecture (§4) describes three per-handler Hedera operator keys, each signing its
own transactions directly. The implementation uses a single relayer that submits enclave-signed
authorizations instead.

This was a deliberate decision. The relayer model keeps the on-chain verification identical — the
contracts check the *enclave's* signature either way — while removing three hot keys from the
enclave's responsibility. The trade-off is the censorship surface described above, which the
HIP-1215 self-refund is there to bound.
