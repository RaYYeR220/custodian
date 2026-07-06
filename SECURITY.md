# Security Policy

Custodian is a hackathon prototype running on **Casper testnet only** — it holds
no mainnet value and no real funds. Still, we take security seriously.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

- Use **GitHub Private Vulnerability Reporting**: the repository's **Security**
  tab → **Report a vulnerability**.
- We aim to acknowledge reports within a few days.

## Scope

- `custodian-contracts/` — the Odra smart contract (access control, escrow /
  payout math, lifecycle state machine).
- `x402/feeds/` — the x402-gated feed server and self-hosted facilitator.
- `mcp/`, `agent/`, `dashboard/` — the TypeScript stack.

Secrets (`.keys/`, `.env`) are gitignored and never committed. If you find a
committed secret, report it privately so we can rotate it.
