# Custodian — Roadmap & Launch Plan

Custodian is an autonomous asset manager for **tokenized real-world assets** on
Casper. Today it manages a commodity shipment in transit — paying x402
micropayments for real-world data, reasoning with an LLM, and acting on-chain via
Odra. This document is the plan to take it from a working testnet prototype to a
real product.

## Where it is today (buildathon build)

- **Live on Casper testnet.** One autonomous run took a tokenized shipment
  `InTransit → Settled` in **25 real transactions** (14 x402 data payments + 11
  contract calls), plus a loss → insurance branch.
- **Full stack, open source:** `Custodian` Odra contract, x402-gated data feeds +
  self-hosted facilitator, `custodian-mcp` server + Agent Skill, the agent
  reasoning loop, and a **live public dashboard** (`https://rayyer220.github.io/custodian/`).
- **Demo:** https://youtu.be/9-1nvBxj_3s

## Roadmap

### Phase 1 — Harden the core (0–2 months)
- **Stablecoin settlement (CEP-18):** settle escrow + payouts in a USD-pegged
  CEP-18 token alongside native CSPR, so appraisals and payouts are denominated
  in stable value (already scoped; native CSPR shipped first for reliability).
- **Real data feeds:** replace the mock feed server with pluggable adapters to
  actual providers (cold-chain IoT/telematics, AIS vessel tracking, customs
  APIs, commodity price oracles) — same x402 pay-per-call interface.
- **Multi-holder cap tables:** issue fractional shares to N investors with
  transferability; on-chain register + pro-rata settlement at scale.
- **Agent hardening:** guardrails, dry-run/simulation gate before every mutating
  action, and a full on-chain + off-chain audit trail per decision.

### Phase 2 — Product & mainnet (2–6 months)
- **Mainnet launch** with a security audit of the `Custodian` contract.
- **Agent fleet:** one operator managing many shipments concurrently, with a
  portfolio view and per-asset risk policies.
- **Insurance integration:** connect the loss → insurance branch to a real
  parametric-insurance partner (claim triggered by verifiable data).
- **x402 data marketplace:** onboard third-party data providers so agents can
  discover and pay any feed — Custodian becomes both a consumer and a driver of
  the Casper x402 economy.

### Phase 3 — RWA financial layer (6–12 months)
- **Lending against cargo:** use the tokenized, actively-managed shipment as
  collateral — under-way inventory financing / trade finance, on-chain.
- **Secondary market** for shipment shares (liquidity for investors mid-voyage).
- **Cross-asset:** extend beyond commodities-in-transit to other RWA an agent can
  monitor and settle (equipment, invoices, warehoused inventory).
- **Decentralized operation:** multi-agent operator sets + DAO governance over
  policies and insurance parameters.

## Business model

- **Settlement fee:** a small basis-point fee on each distribution/settlement the
  agent executes.
- **x402 data margin:** Custodian brokers the data feeds agents pay for; a take on
  marketplace volume.
- **SaaS for asset managers / trade-finance desks:** a hosted operator + dashboard
  for firms that want autonomous management without running the stack.

Target users: commodity traders and trade-finance desks, freight forwarders,
RWA tokenization funds, and insurers seeking verifiable, data-driven claims.

## Why Casper

Casper is building the **trust layer for the agent economy**: native **x402**
micropayments, the **Odra** contract framework, MCP servers, and Agent Skills.
Custodian is built entirely on that AI Toolkit — it's the kind of autonomous,
real-world, on-chain application the stack is designed for.

## Presence & how to follow

Custodian is developed in the open:

- **Code:** https://github.com/RaYYeR220/custodian (public, CI + CodeQL + Dependabot)
- **Live demo:** https://rayyer220.github.io/custodian/
- **Demo video:** https://youtu.be/9-1nvBxj_3s
- **Updates & questions:** GitHub Issues / Discussions on the repo, and the
  project's DoraHacks BUIDL page.

Built solo for the Casper Agentic Buildathon, with the intent to keep building on
Casper toward a production RWA asset-management product.
