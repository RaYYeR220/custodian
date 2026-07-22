# Reviewing Custodian in 5 minutes

Everything a judge needs to verify every claim, with direct links. Custodian is
an autonomous agent that manages a **tokenized real-world asset** on Casper:
**pay x402 for real-world data → reason with an LLM → act on-chain (Odra)**.

## 1. See it run (1 min) — no install, no keys
Open the **live demo** and press **▶ Replay**:
- **https://rayyer220.github.io/custodian/**

It replays a *real* Casper-testnet run: a coffee shipment goes `InTransit →
Settled`. Watch the **x402 spend counter** tick up, the agent revalue on the
cold-chain breach (5 → 3.5 CSPR), clear customs, and distribute proceeds. Switch
the run selector (top-right) to the **loss → insurance** branch.

Prefer video? **https://youtu.be/9-1nvBxj_3s**

## 2. Verify it's real on-chain (1 min)
One autonomous run = **25 real testnet transactions**. Open any on
`https://testnet.cspr.live/transaction/<hash>`:

- revalue (cold-chain breach): `ead9e6edfbfd72b81a60ca13255698f7ec792144866cc79e0f8cb0f77bf7500e`
- confirm_delivery: `c0d4245b2095109d5165563364b228523a913a917685477b13ad2af0eefd1599`
- distribute → Settled: `99b20ce7e76ea5b0b084f83862749897cf38e71e124c9f446938f91207b31223`
- x402 data settlement (sample): `92c7b129093ba35654f3e6b7d3708ab83aba8172243706d86dbae0de3728811b`

Contracts on `casper-test`:
- **Custodian** package: `9342311dc3d948ee673d06942cfcec5935e844a2687df27e8af5d7f7ba7cde02`
- **X402 data-payment token** (CEP-18): `265ee18c6883e72c6a4ad5ea5a9486f727b57c741f7cd6203c29cbe72b0f59bd`

**The feeds are not mocks.** `GET /telemetry?live=1` returns the **real current
temperature** at the cargo's coordinates from Open-Meteo, behind the same x402
paywall. Proven live — this settlement
(`69f2e45b12e7c2cc09f7eb98f295b6675d34b7c986ab1536c7078fb6e87aee8b`) returned
`{"temp_c":17.8,"source":"open-meteo"}` for Rotterdam. The demo journey stays
scripted so the narrative is reproducible.

## 3. Fractional ownership, settled pro-rata on-chain (30 s)
The default run manages a shipment owned by **two investors (60% / 40%)**. When
the agent distributed the 3.5 CSPR proceeds, the split landed on-chain:

- `distribute` tx: `d1db9e228583a39308614761a0483a17558324808e6609da126475b924b93f32`
- the 40% investor's account now holds exactly **1.4 CSPR** — check it yourself:

```bash
curl -s -X POST https://node.testnet.casper.network/rpc -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query_balance","params":{"purse_identifier":
      {"main_purse_under_account_hash":"account-hash-eb46ac01d8757f8e09b9fc454aa90ffeb9fc54a267b9775bc4bfa81ee09a4c67"}}}'
# -> "balance":"1400000000"   (= 40% of the 3.5 CSPR payout)
```

## 4. Confirm the agent actually reasons (1 min)
The agent's judgment is **graded** against a hidden answer key — it takes the
correct on-chain action in each situation and refuses the wrong ones:

- **[`EVAL.md`](EVAL.md) — 6/6 scenarios** (nominal, breach, market move, customs,
  delivery, loss). Reproduce: `cd agent && npm install && npm run build && npm run eval`.

## 5. Run the agent yourself, offline (2 min)
Real LLM reasoning over a simulated chain — needs only an OpenRouter key:

```bash
echo "OPENROUTER_API_KEY=sk-or-..." > .env
cd agent && npm install && npm run build && npm run dry   # drives a full journey to Settled
```

## What to look at in the code
- **The x402 loop is load-bearing** — the agent can't act without first *paying*
  for the data: `agent/src/agent.ts` (loop), `mcp/SKILL.md` (operating rules),
  `x402/feeds/` (x402-gated feeds + self-hosted facilitator; `/telemetry?live=1`
  serves **real** Open-Meteo temperature behind the paywall).
- **Working contract** — `custodian-contracts/src/custodian.rs`: tokenize, revalue,
  customs, deliver/distribute, loss/insurance; native-CSPR escrow settlement.
- **AI Toolkit** — MCP server (`mcp/`) + Agent Skill (`mcp/SKILL.md`) are the
  agent's tool surface; Odra is the contract framework.

Roadmap / launch plan: [`ROADMAP.md`](ROADMAP.md).
