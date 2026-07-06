# Contributing to Custodian

Thanks for your interest! Custodian is a Casper Agentic Buildathon project — an
autonomous agent that manages a tokenized real-world asset on Casper
(**pay x402 for data → reason → act on-chain**). This guide gets you building.

## Repo layout

| Dir | What | Stack |
|-----|------|-------|
| `custodian-contracts/` | `Custodian` Odra contract | Rust / Odra 2.8 |
| `x402/feeds/` | x402-gated data feeds + self-hosted facilitator | Go |
| `mcp/` | `custodian-mcp` server + `SKILL.md` | TypeScript |
| `agent/` | autonomous reasoning loop | TypeScript |
| `dashboard/` | demo dashboard | TypeScript / vanilla |

## Quickstart (offline, no gas)

```bash
# agent — real LLM reasoning over a simulated chain
cd agent && npm install && npm run build && npm test && npm run dry
# dashboard — renders the run
cd ../dashboard && npm start   # http://localhost:4030
```

See each directory's `README.md` for details, and the top-level `README.md` for
the architecture and the live-run prerequisites.

## Pull requests

- Branch from `main`, keep changes focused, and describe the *why*.
- Run the relevant build/test before opening a PR:
  - TS: `npm run build` (and `npm test` in `agent/`).
  - Contracts: Odra unit tests (`cargo odra test` — see `custodian-contracts/`).
- Never commit secrets. `.keys/` and `.env` are gitignored; keep them that way.
- Match the surrounding code style (naming, comment density, idiom).

## Reporting bugs / security

- Bugs: open an issue using the template.
- Security: see [`SECURITY.md`](SECURITY.md) — use private vulnerability reporting,
  not a public issue.
