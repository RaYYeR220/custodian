# Custodian MCP server (Agent Skills layer)

Plan 3 of the **Custodian** Casper hackathon project. A TypeScript
[Model Context Protocol](https://modelcontextprotocol.io) server (stdio
transport) that exposes the agent's capabilities as clean MCP tools — the
"Agent Skills" layer of the Casper AI Toolkit.

It is a **thin orchestrator**: every tool shells an already-proven command.
No on-chain plumbing is reinvented here.

- **Contract read/write** -> shells `odra-cli` (`custodian_contracts_cli`) inside
  the `casper-odra:dev` Docker image (proven in Plan 1). Targets the deployed
  `Custodian` package `9342311dc3d948ee673d06942cfcec5935e844a2687df27e8af5d7f7ba7cde02`
  on Casper testnet; operator key is `.keys/secret_key.pem` (wired via
  `custodian-contracts/.env`).
- **x402 data feeds** -> shells a parameterized Go x402 client
  (`x402/feeds/client-fetch`) inside `golang:1.25` (reuses the proven Plan 2
  stack). Pays a micropayment settled on testnet, returns the data + tx hash.

## Tools

### Reads (free)
| Tool | Args | Returns |
| --- | --- | --- |
| `get_shipment` | `id:number` | full shipment record (JSON) |
| `get_status` | `id:number` | `{ status }` (Created/InTransit/Delivered/Lost/Settled) |
| `get_value` | `id:number` | `{ appraised_value }` (motes) |
| `get_data_spend` | `id:number` | `{ data_spend }` |

### Actions (operator-gated, return a tx hash)
| Tool | Args |
| --- | --- |
| `revalue` | `id:number, new_unit_price:string, new_condition_score:number(0..100), reason_code:number(0..255)` |
| `flag_delay` | `id:number, penalty:string` |
| `set_customs` | `id:number, at_customs:boolean, location:string` |
| `confirm_delivery` | `id:number` |
| `distribute` | `id:number` |
| `report_loss` | `id:number` |
| `trigger_insurance` | `id:number` |
| `record_data_spend` | `id:number, amount:string` |

`*_unit_price`, `penalty`, `amount` are U512 decimal strings (CSPR motes / token
units). Gas is fixed per call (5e9 simple, 6e9 for distribute/trigger_insurance).

### x402 feeds (cost a micropayment; need the feed services up)
| Tool | Args | Returns |
| --- | --- | --- |
| `pay_for_telemetry` | `shipment:string, tick:number` | `{ status, tx, data:{ temp_c, humidity, lat, lon, lost, note, ts } }` |
| `pay_for_price` | `commodity:string, tick:number` | `{ status, tx, data:{ unit_price, currency, ts } }` |
| `pay_for_customs` | `shipment:string, tick:number` | `{ status, tx, data:{ at_customs, cleared, location, ts } }` |

See `SKILL.md` for the operating procedure (decision rules) that drives which
tool to use when.

## Run

```bash
cd mcp
npm install
npm run build          # tsc -> dist/
node dist/server.js    # MCP server on stdio
```

Register with an MCP client (e.g. Claude Desktop / Claude Code) by pointing it
at `node /abs/path/to/mcp/dist/server.js`.

### Validate

```bash
npm run build
node dist/test-client.js          # tools/list + get_shipment id=0 (live testnet)
node dist/test-client.js --write  # also calls record_data_spend id=0 (sends a tx)
```

Expected: all 15 tool names listed, then shipment 0's live JSON
(`DEMO Coffee Santos->Rotterdam`, status `Settled`).

## Runtime dependencies

- **Contract tools** need **Docker** running with the `casper-odra:dev` image and
  the `casper-cargo` / `casper-target` named volumes (built in Plan 1). The
  natively-built `custodian-contracts/wasm/Custodian.wasm` must be present.
- **x402 feed tools** additionally need the **x402 facilitator (:4022)** and the
  **feed server (:4023)** running and reachable. The MCP server does **not**
  start them. Bring them up via `x402/feeds/run-feeds.sh` (one-container e2e) or
  run the facilitator + `go run ./server` as long-lived services.
  - If the services run on the host / another container, override
    `FEEDS_FACILITATOR_URL` and `FEEDS_SERVER_URL` (e.g.
    `http://host.docker.internal:4022`). The feed-client container is launched
    with `--add-host host.docker.internal:host-gateway`.

### Config (env overrides, all optional — defaults match the proven setup)
`FEEDS_FACILITATOR_URL`, `FEEDS_SERVER_URL`, `FEEDS_PAYEE_ADDRESS`,
`CAIP2_CHAIN_ID`, `FEEDS_ASSET_PACKAGE`, `FEEDS_ASSET_NAME`.

## Layout
- `src/odra.ts` — Docker odra-cli wrapper (reads parse `Call result:` JSON;
  writes parse the tx hash; retries once on the flaky `/events` 504).
- `src/feeds.ts` — Go x402 client wrapper (golang:1.25).
- `src/server.ts` — MCP server wiring (the 15 tools).
- `src/test-client.ts` — smoke-test MCP client.
- `../x402/feeds/client-fetch/` — the parameterized Go x402 client this server shells.
