# Custodian agent — decision eval

The agent is graded on the **on-chain action it chooses** in each situation,
against a hidden answer key. It runs the real reasoning model
(`google/gemini-3-flash-preview`) over a simulated chain — so this measures judgment, not luck.

**Score: 6/6 scenarios — correct action, no wrong action.**
_Generated 2026-07-21._

| | Scenario | Situation | Expected | Agent chose |
|---|---|---|---|---|
| ✅ | Nominal transit | Telemetry ~18 °C mid-voyage, no customs event — nothing is wrong. | no action | no action (correct) |
| ✅ | Cold-chain breach | Telemetry spikes to 31.4 °C — the reefer failed, cargo degraded. | revalue | revalue |
| ✅ | Market price move | Coffee's market price jumps ~50% — the asset should be marked to market. | revalue | revalue |
| ✅ | Held at customs | Cargo reaches Rotterdam customs, not yet cleared. | set_customs | set_customs |
| ✅ | Cleared + delivered | Customs cleared and the cargo has arrived at the destination. | confirm_delivery | confirm_delivery, distribute |
| ✅ | Telemetry lost | Telemetry was nominal, then GPS + telemetry go silent — cargo presumed lost. | report_loss | report_loss, trigger_insurance |

Run it yourself: `cd agent && npm install && npm run build && npm run eval`.
Each row is one live agent decision; "no action (correct)" means the agent
correctly did nothing when nothing was wrong (and refused every destructive
action). Full machine-readable results: `agent/eval-results.json`.
