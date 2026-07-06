# Custodian Dashboard (Plan 5)

A zero-dependency web dashboard for the demo video. It is a **pure renderer** of
the agent's run logs (`agent/runs/<runId>.jsonl`): a shipment card (route,
status, live appraised value, condition gauge, escrow, latest telemetry), an
**activity log** with every x402 payment and on-chain action linked to
`testnet.cspr.live`, and a prominent **x402 data-spend counter**.

## Run

```bash
cd dashboard
npm start            # -> http://localhost:4030  (DASH_PORT to override)
```

Open the URL. It loads the newest run automatically. No build step, no deps.

## Controls

- **Run selector** — pick any run in `agent/runs/`.
- **▶ Replay** — replays the run event-by-event with animation (use this for the
  demo video: watch the agent pay for data, react to the cold-chain breach,
  revalue, clear customs, and settle).
- **Show all** — render the final state instantly.
- **Live** — poll the newest run every 1.5 s and stream new events as the agent
  produces them (turn this on, then start a live agent run in another terminal).

## Notes

- Dry-run logs (`dry-*`) show a yellow banner and the tx hashes are illustrative
  (they won't resolve on cspr.live). A **live** run produces real, clickable
  testnet transactions.
- The x402 spend counter sums every `feed_paid` micropayment (0.1 X402 each).
- Data source dir: `../agent/runs`. The server never writes — it only reads logs.
