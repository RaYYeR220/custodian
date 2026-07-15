# Custodian — Autonomous RWA Asset Manager on Casper

> Casper Agentic Buildathon entry. An autonomous agent that manages a
> **tokenized real-world asset** (a commodity shipment in transit) on Casper,
> with a load-bearing loop:
>
> **pay x402 micropayments for real-world data → reason (Gemini + MCP) → act on-chain (Odra).**

**🌐 Live demo:** https://rayyer220.github.io/custodian/ &nbsp;·&nbsp; **▶ Demo video:** https://youtu.be/9-1nvBxj_3s

The live demo replays an actual autonomous testnet run — every on-chain action links to `testnet.cspr.live`.

A coffee container is tokenized on Casper (its value held in escrow, shares to
investors). As it sails Santos → Rotterdam, the agent **pays per data call** for
temperature, GPS, customs and price feeds (x402 micropayments settled on
testnet), reasons over the readings, and takes **operator-gated on-chain
actions**: re-appraise on a cold-chain breach, handle customs, confirm delivery
and distribute proceeds — or, if the cargo is lost, trigger insurance. Every data
purchase and every action is a real testnet transaction.

## Why it's interesting

- **x402 is load-bearing, not decoration.** The agent cannot act without first
  *paying* for the data that justifies the action — autonomous, per-call,
  on-chain settlement of real-world information.
- **Real on-chain asset management.** Tokenized value, lifecycle settlement, and
  pro-rata payouts in native CSPR via an Odra contract — not a toy.
- **A real Casper AI-Toolkit story.** The agent's capabilities are exposed as an
  **MCP server**, and the operating procedure is packaged as an **Agent Skill**
  (`mcp/SKILL.md`) that literally drives the model.

## Architecture

```
                 ┌─────────────────────────────────────────────┐
                 │  agent/  (TS reasoning loop)                 │
                 │  per tick: pay → reason (Gemini) → act       │
                 └───────────────┬─────────────────────────────┘
                                 │ MCP (stdio, function tools)
                 ┌───────────────▼─────────────────────────────┐
                 │  mcp/  custodian-mcp server + SKILL.md        │
                 │  15 tools: reads · actions · x402 feed-pays   │
                 └───────┬───────────────────────┬──────────────┘
            odra-cli     │                       │   Go x402 client
          (Docker)       │                       │   (Docker)
                 ┌───────▼────────┐      ┌───────▼──────────────┐
                 │ Custodian       │      │ x402/feeds  (Go)      │
                 │ Odra contract   │      │ /telemetry /price     │
                 │ (Casper testnet)│      │ /customs — x402-gated │
                 └─────────────────┘      │ + self-hosted         │
                                          │   facilitator         │
                                          └───────────────────────┘

   dashboard/  renders agent/runs/*.jsonl → shipment card · activity log
               (cspr.live tx links) · x402 spend counter   (demo video)
```

Five layers, each independently runnable and tested:

| Dir | What | Stack |
|-----|------|-------|
| `custodian-contracts/` | `Custodian` Odra contract — tokenize, revalue, customs, deliver/distribute, loss/insurance; native-CSPR escrow settlement | Rust / Odra 2.8 |
| `x402/feeds/` | x402-gated mock data feeds + self-hosted facilitator; scripted Santos→Rotterdam journey | Go |
| `mcp/` | `custodian-mcp` server (15 tools) + `SKILL.md` operating procedure | TypeScript / MCP |
| `agent/` | autonomous reasoning loop (pay → reason → act) | TypeScript / OpenRouter |
| `dashboard/` | demo dashboard (pure renderer of run logs) | TypeScript / vanilla |

## Quickstart (offline — no Docker, no gas)

The agent's reasoning loop runs against a fully **simulated** chain + feeds, so
you can see it work end-to-end with just an OpenRouter key.

```bash
# 1. key (gitignored)
echo "OPENROUTER_API_KEY=sk-or-..." > .env

# 2. agent — real LLM reasoning, simulated chain
cd agent && npm install && npm run build && npm test
npm run dry            # drives the full journey to Settled

# 3. dashboard — open http://localhost:4030, hit ▶ Replay
cd ../dashboard && npm start
```

The dry run does what the live run does — pays for feeds each tick, detects the
cold-chain breach at tick 3 (31.4 °C) and revalues the cargo down (5 → 3.5 CSPR),
clears customs, then confirms delivery and distributes proceeds — only the chain
and x402 settlements are simulated.

## Live run (real x402 payments + real on-chain actions)

See `agent/README.md` for the full prerequisites. In short: build `mcp/`, bring
up the facilitator (:4022) + feed server (:4023)
(`x402/feeds/serve-feeds.sh` in a `golang:1.25` container with the ports
published), tokenize a fresh shipment, then:

```bash
cd agent && npm start -- --shipment <id>
```

Every feed payment and every action is a real `casper-test` transaction
(`https://testnet.cspr.live/transaction/<hash>`).

## Testnet artifacts

Chain `casper-test`, RPC `https://node.testnet.casper.network/rpc`.

- **Custodian contract package:** `9342311dc3d948ee673d06942cfcec5935e844a2687df27e8af5d7f7ba7cde02`
- **X402 data-payment token (CEP-18):** `265ee18c6883e72c6a4ad5ea5a9486f727b57c741f7cd6203c29cbe72b0f59bd`

**Proven on testnet** — one autonomous live run, shipment `InTransit → Settled`,
**25 real transactions** (`https://testnet.cspr.live/transaction/<hash>`):

| Step | tx |
|------|-----|
| revalue (cold-chain breach, 5 → 3.5 CSPR) | `ead9e6edfbfd72b81a60ca13255698f7ec792144866cc79e0f8cb0f77bf7500e` |
| confirm_delivery | `c0d4245b2095109d5165563364b228523a913a917685477b13ad2af0eefd1599` |
| distribute → Settled (3.5 CSPR pro-rata) | `99b20ce7e76ea5b0b084f83862749897cf38e71e124c9f446938f91207b31223` |
| x402 data settlement (sample) | `92c7b129093ba35654f3e6b7d3708ab83aba8172243706d86dbae0de3728811b` |

See the full run in the [demo video](https://youtu.be/9-1nvBxj_3s).

## Status

All five layers built, committed, and proven **end-to-end on Casper testnet**:
the agent autonomously took a tokenized shipment from `InTransit` to `Settled` —
paying real x402 micropayments for data and submitting real `Custodian`
transactions (revalue on the cold-chain breach → customs → deliver → distribute),
**25 real testnet transactions** in one run (see the ledger above).
