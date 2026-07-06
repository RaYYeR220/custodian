---
name: custodian-asset-manager
description: >-
  Operate the Custodian on-chain asset manager for a commodity-in-transit
  shipment on Casper. Use this skill when monitoring a tokenized cargo (e.g. a
  coffee container Santos -> Rotterdam), paying for real-world data feeds, and
  taking on-chain actions in response: revalue on cold-chain breach or price
  moves, handle customs, confirm delivery and distribute proceeds, or report a
  loss and trigger insurance. Backed by the custodian-mcp server's tools.
---

# Custodian — autonomous RWA asset manager (Casper)

You manage a **tokenized real-world asset** (a commodity shipment in transit)
recorded in the `Custodian` contract on Casper testnet. You acquire real-world
data by paying **x402 micropayments**, reason over it, and act **on-chain** via
operator-gated contract calls. Each shipment has an id (`u64`); the demo
shipment is **id 0** (DEMO Coffee, Santos -> Rotterdam).

All money fields are **CSPR motes** (1 CSPR = 1e9 motes). `condition_score` is
0..100 (100 = perfect). The shipment lifecycle is:

```
Created -> InTransit -> Delivered -> Settled
                     \-> Lost     -> Settled (via insurance)
```

Most actions only work while **InTransit** (the contract reverts otherwise) —
always check status first.

## The tools (custodian-mcp)

**Reads (free, do these liberally to stay oriented):**
- `get_shipment(id)` — full record (status, escrow, appraised_value, at_customs, etc.).
- `get_status(id)` — just the lifecycle status.
- `get_value(id)` — current appraised value (motes).
- `get_data_spend(id)` — cumulative recorded data-feed spend.

**Data feeds (cost an x402 micropayment, settled on testnet):**
- `pay_for_telemetry(shipment, tick)` -> `{ temp_c, humidity, lat, lon, lost, note, ts }`.
- `pay_for_price(commodity, tick)` -> `{ unit_price, currency, ts }`.
- `pay_for_customs(shipment, tick)` -> `{ at_customs, cleared, location, ts }`.

**Actions (operator-gated, each returns a tx hash):**
- `revalue(id, new_unit_price, new_condition_score, reason_code)`
- `flag_delay(id, penalty)`
- `set_customs(id, at_customs, location)`
- `confirm_delivery(id)`
- `distribute(id)`
- `report_loss(id)`
- `trigger_insurance(id)`
- `record_data_spend(id, amount)`

## Operating procedure (decision rules)

Work tick by tick. At each tick, pay for the feeds you need, then act:

1. **Cold-chain breach** — if `pay_for_telemetry` shows `temp_c` outside the safe
   band (e.g. > ~25 °C for chilled cargo; the demo breach at tick 3 is 31.4 °C),
   the goods are damaged. **Revalue down**: call
   `revalue(id, <unchanged unit_price>, <lower condition_score>, reason_code=1)`.
   The contract recomputes appraised value = qty * unit_price * score / 100.
   (Demo: drop condition_score to ~70 -> value 5 CSPR becomes 3.5 CSPR.)

2. **Market price move** — if `pay_for_price` shows the commodity's `unit_price`
   moved materially, **revalue** with the new `unit_price` (keep condition_score)
   and `reason_code=2`.

3. **Delay** — if telemetry/customs shows the shipment stuck/behind schedule,
   `flag_delay(id, penalty)` to record a cumulative penalty.

4. **Customs** — when `pay_for_customs` shows `at_customs:true`, call
   `set_customs(id, true, <location>)`. When it flips to `cleared:true` (demo:
   tick 6) and the cargo is at its destination, proceed to delivery.

5. **Delivery + settlement** — once **customs is cleared AND the cargo is at the
   destination**: `confirm_delivery(id)` (InTransit -> Delivered), then
   `distribute(id)` (pays appraised value, capped at escrow, pro-rata to holders
   in native CSPR; status -> Settled).

6. **Loss + insurance** — if **telemetry/GPS goes silent** (`lost:true`, or no
   movement / zeroed lat-lon across ticks; demo: `shipment='loss'`), the cargo is
   presumed lost. `report_loss(id)` (InTransit -> Lost), then
   `trigger_insurance(id)` (pays insurance_coverage, capped at escrow, pro-rata;
   status -> Settled). Do NOT distribute a lost shipment — insurance is the path.

7. **Audit data cost** — after every `pay_for_*` call, record the spend on-chain
   with `record_data_spend(id, amount)` (the per-call price is 100000000 = 0.1
   X402 token by default) so the asset's data-acquisition cost is auditable via
   `get_data_spend`.

### Guardrails
- Never call a mutating action on a shipment whose status forbids it — read
  `get_status` first. distribute requires Delivered; trigger_insurance requires
  Lost; revalue/flag_delay/set_customs/report_loss require InTransit.
- A shipment is `Settled` once distributed or insured — stop acting on it.
- A revalue's `new_unit_price` is a decimal string of motes; `condition_score`
  and `reason_code` are small integers.
- If an action's events SSE flakes (504), the tool already retries once; the tx
  usually lands — re-read state to confirm rather than blindly re-sending.

### Worked example (the demo journey, shipment 0)
- tick 0–2: telemetry nominal — just observe + `record_data_spend`.
- **tick 3**: telemetry = COLD-CHAIN BREACH (31.4 °C) -> `revalue(0, 5000000, 70, 1)`.
- tick 5: customs = at customs, not cleared -> `set_customs(0, true, "...")`.
- **tick 6**: customs = cleared, arrived Rotterdam -> `confirm_delivery(0)` then `distribute(0)`.
- Loss variant: `pay_for_telemetry("loss", 4)` shows `lost:true` ->
  `report_loss(0)` then `trigger_insurance(0)`.
