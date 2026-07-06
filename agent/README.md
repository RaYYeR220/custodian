# Custodian Agent (Plan 4)

The autonomous RWA asset-manager. Per journey tick it **pays x402 micropayments
for real-world data → reasons with Gemini (`google/gemini-3-flash-preview` via
OpenRouter) → acts on-chain** on the `Custodian` contract. The agent is an **MCP
client**: it spawns the proven `custodian-mcp` server and calls its 15 tools, and
it is driven by the same `mcp/SKILL.md` operating procedure (used as the system
prompt). No on-chain plumbing is reimplemented here.

## Install / build

```bash
cd agent
npm install
npm run build
npm test        # offline unit tests (pure fns + dry backend + scripted loop)
```

## Configuration

Put your OpenRouter key in the **repo-root** `.env` (gitignored):

```
OPENROUTER_API_KEY=sk-or-...
```

Optional overrides: `AGENT_MODEL`, `OPENROUTER_BASE_URL`, `AGENT_COMMODITY`.

## Dry run (recommended first — no Docker/testnet/x402)

Real LLM reasoning over a fully **simulated** chain + data feeds. Drives the
full journey to `Settled`:

```bash
npm run dry                       # shipment 0, ticks 0-7
npm run dry -- --shipment 0 --ticks 0-7
```

The dry backend mirrors the on-chain demo numbers (qty 1000, unit_price
5_000_000, 5 CSPR escrow, 4 CSPR insurance) and the scripted Go journey
(cold-chain breach at tick 3 = 31.4 °C, customs cleared tick 6, delivered tick
7). Use it to validate the loop logic without spending testnet gas.

## Live run (real x402 payments + real on-chain actions)

Prerequisites:
1. `cd mcp && npm run build` (the agent spawns `mcp/dist/server.js`).
2. The x402 **facilitator (:4022)** and **feed server (:4023)** running and
   reachable (see `x402/feeds/run-feeds.sh`). Set `FEEDS_FACILITATOR_URL` /
   `FEEDS_SERVER_URL` if they are not on `localhost`.
3. A **fresh InTransit shipment** tokenized — shipment 0 is already `Settled`.
   Tokenize a new one:
   `docker run ... casper-odra:dev sh -c "cargo run -q --bin custodian_contracts_cli -- scenario tokenize-demo"`
   (creates id 1, 2, …).
4. `OPENROUTER_API_KEY` in the root `.env`.

```bash
npm start -- --shipment 1               # ticks 0-7
npm start -- --shipment 1 --ticks 0-7 --max-steps 8
```

Every on-chain action prints + logs its testnet tx hash
(`https://testnet.cspr.live/transaction/<hash>`).

## Output

Each run appends a structured JSONL log to `agent/runs/<runId>.jsonl`
(events: `run_start`, `tick_start`, `feed_paid`, `action`, `tick_end`,
`settled`, `run_end`). The Plan 5 dashboard reads these.

## Flags

| Flag | Default | Meaning |
|------|---------|---------|
| `--dry-run` | off | simulate the chain + feeds (offline) |
| `--shipment <id>` | `0` | shipment id to manage |
| `--ticks <a-b>` | `0-7` | inclusive journey tick range |
| `--max-steps <n>` | `8` | tool-call cap per tick |
