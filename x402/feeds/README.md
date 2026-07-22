# Custodian — x402-gated mock data-feed server

Part of the **Custodian** Casper hackathon project (Plan 2). A small Go service
that serves shipment-relevant data behind the **x402 paywall**, so a downstream
agent must pay a micropayment (settled on Casper testnet in the deployed Cep18
`Casper X402 Token`) to read each data point.

It reuses the proven `casper-x402` SDK middleware (the same stack validated in
the spike, see repo `SPIKE_RESULTS.md` and `x402/run-x402-spike.sh`).

## Endpoints

| Method & path | Paid? | Returns |
| --- | --- | --- |
| `GET /telemetry?shipment=<id>&tick=<n>` | yes | `{ temp_c, humidity, lat, lon, lost, note, ts }` |
| `GET /price?commodity=<sym>&tick=<n>` | yes | `{ unit_price, currency:"USD", ts }` |
| `GET /customs?shipment=<id>&tick=<n>` | yes | `{ at_customs, cleared, location, ts }` |
| `GET /health` | no | `{ "status":"ok" }` |

Each paid call costs `$0.001` (which the server's `MoneyParser` maps to a fixed
on-chain amount — default `100000000` = **0.1 X402 token**, 9 decimals).

## The scripted journey

A coffee container, **Santos (BR) → Rotterdam (NL)**, indexed by `tick` 0..7.
Everything is hardcoded (`server/journey.go`) so the demo is deterministic.

| tick | telemetry | customs |
| --- | --- | --- |
| 0 | departed Santos, 18.2 °C | at sea |
| 1 | mid-Atlantic, 18.0 °C | at sea |
| 2 | crossing equator, 17.8 °C | at sea |
| **3** | **COLD-CHAIN BREACH, 31.4 °C** | at sea |
| 4 | temp recovered (degraded), 18.5 °C | at sea |
| 5 | approaching port, 18.1 °C | **at customs, not cleared** |
| 6 | arrived Rotterdam, 17.9 °C | **cleared** |
| 7 | delivered at terminal | cleared |

At tick 3 the agent is expected to **revalue the cargo down** (breach), and from
tick 5→6 it watches customs flip to `cleared:true`.

### Loss / insurance variant

Pass `shipment=loss` **or** `scenario=loss` to `/telemetry` and the feed goes
silent: `{ "lost": true, temp_c:0, lat:0, lon:0, ... }` so the agent can trigger
an insurance claim. Example: `GET /telemetry?shipment=loss&tick=4`.

Out-of-range ticks clamp to the journey bounds (ticks past 7 pin to "delivered").

## How to run (Docker)

Go is not installed natively on the dev host — everything runs in the
`golang:1.25` image. The validation runner starts the facilitator + our server +
a client that does `/health` (free) → `/telemetry?tick=3` (breach, paid) →
`/customs?tick=6` (cleared, paid), all in one container:

```bash
# from the repo root
docker run --rm \
  -v "${PWD}:/work" \
  -v "${PWD}/.keys:/keys:ro" \
  -v go-mod-cache:/go/pkg/mod \
  -v go-build-cache:/root/.cache/go-build \
  -w /work \
  golang:1.25 \
  bash /work/x402/feeds/run-feeds.sh
```

To just build / tidy:

```bash
docker run --rm -v "${PWD}:/work" \
  -v go-mod-cache:/go/pkg/mod -v go-build-cache:/root/.cache/go-build \
  -w /work/x402/feeds golang:1.25 \
  bash -c "go mod tidy && go build ./..."
```

## Module layout & the `replace` directive

`x402/feeds/` is a **separate Go module** (`custodian/feeds`) that depends on the
casper-x402 SDK via a replace pointing at the gitignored reference clone:

```
replace casper_x402_facilitator => ../../.reference/casper-x402
```

So the whole project must be mounted at `/work` for the relative path to resolve
(`/work/.reference/casper-x402` and `/work/x402/feeds` coexist).

The reference SDK is a **third-party open-source repo**, so it is not vendored
here. Clone it once, from the repo root, before building this module:

```bash
git clone https://github.com/make-software/casper-x402 .reference/casper-x402
```

Then the Go build resolves normally:

```bash
docker run --rm -v "$PWD:/work" -w /work/x402/feeds golang:1.25 go build -o /tmp/feeds-server ./server
```

- `server/` — the x402-gated Gin server (`main.go`, `config.go`, `journey.go`)
- `client/` — a tiny validation client (free `/health` + two paid calls)
- `run-feeds.sh` — the one-container e2e runner

## Environment variables

Set by `run-feeds.sh`; mirrors `x402/run-x402-spike.sh`.

**Facilitator** (self-hosted, no API key):
`CASPER_NETWORKS`, `SECRET_KEY_PEM_CASPER_CASPER_TEST`,
`SECRET_KEY_ALGO_CASPER_CASPER_TEST`, `RPCURL_CASPER_CASPER_TEST`,
`TRANSACTION_PAYMENT_MOTES`.

**Feed server:**
`PAYEE_ADDRESS` (account-hash receiving payments),
`FACILITATOR_URL` (`http://localhost:4022`), `CAIP2_CHAIN_ID`
(`casper:casper-test`), `ASSET_PACKAGE`, `ASSET_NAME`,
`FEEDS_PORT` (default `4023`), `FEEDS_PRICE_AMOUNT` (default `100000000`).

> The server uses `FEEDS_PORT`, **not** `PORT`, on purpose — the facilitator and
> the reference server both read `PORT` (default 4022 / 4021) and would collide.

**Client:**
`CLIENT_PRIVATE_KEY_PATH`, `CLIENT_KEY_ALGO` (`ed25519`),
`FEEDS_SERVER_URL` (`http://localhost:4023`), `CAIP2_CHAIN_ID`.

## Verified result

A real run settled two payments on Casper testnet, e.g.:

```
GET /telemetry?tick=3 -> 200, tx aa38c729...db60
  {"temp_c":31.4,"humidity":78,"lat":20.1,"lon":-18.7,"note":"COLD-CHAIN BREACH",...}
GET /customs?tick=6   -> 200, tx b32df266...9f4c
  {"at_customs":true,"cleared":true,"location":"Rotterdam customs",...}
```
