# TradeLayer

**Private trading for institutions.**

An institution registers on-chain, funds a treasury in USDC, decides who may trade and how much,
and its people buy real tokenised equities on its behalf — without publishing what they trade or
what they hold.

Orders are sealed in the browser and opened only inside a **Chainlink Confidential Workflow**
running in an AWS Nitro enclave. The enclave checks the institution's private rules, places one
real broker order, and signs an EIP-712 settlement that a relayer submits to Hedera. Positions
live encrypted in `ConfidentialLedger`. Shares are **ATS equity tokens** pooled in an omnibus
vault. Unfilled orders refund themselves through the Hedera Schedule Service.

> Not even the operator can see the order flow.

## Where to start

| If you want to | Read |
|---|---|
| Understand why this exists | [The problem](concepts/the-problem.md) |
| Understand how it works in three ideas | [Three ideas](concepts/three-ideas.md) |
| Know exactly what leaks and what doesn't | [What is private](concepts/privacy.md) |
| See the moving parts | [Architecture overview](architecture/overview.md) |
| Run it | [Running it locally](guides/running-locally.md) |
| Know what it can't do yet | [Honest limits](limits.md) |

## Status

Live on Hedera testnet against a real Alpaca paper-trading account. Five contracts deployed and
verified (Sourcify `exact_match`), the Chainlink workflow deployed to the CRE private registry,
the web app and intake API hosted.

Built for **ETHOnline 2026** — Hedera *Tokenization of Anything* and Chainlink *Best Confidential
Workflow*.

## A note on sources

This documentation is generated from two places that do not always agree: the codebase, and the
architecture specification maintained in Notion (v1.5). Where they diverge, these pages describe
**what the code actually does** and flag the divergence. The most significant ones are collected
in [Honest limits](limits.md).
