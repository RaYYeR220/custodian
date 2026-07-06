// config.ts — runtime configuration for the Custodian agent.
//
// The OpenRouter API key lives in the repo-root `.env` (gitignored). We load it
// here with Node's built-in `process.loadEnvFile` (Node >= 20.6) so there is no
// dotenv dependency. Anything already in the process env wins (CI / overrides).

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/ -> agent/ -> repo root
export const REPO_ROOT = resolve(__dirname, "..", "..");
export const AGENT_DIR = resolve(__dirname, "..");

// Best-effort: load repo-root .env into process.env if not already set.
try {
  process.loadEnvFile(resolve(REPO_ROOT, ".env"));
} catch {
  // No .env (e.g. dry-run without a key set elsewhere) — fine; we validate lazily.
}

/** OpenRouter API key (required for any real LLM call). */
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";

/** The reasoning model — Gemini via OpenRouter (chosen over Anthropic for cost). */
export const MODEL = process.env.AGENT_MODEL ?? "google/gemini-3-flash-preview";

/** OpenRouter is OpenAI-compatible. */
export const BASE_URL =
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

// --- Demo / loop constants (mirror mcp/SKILL.md + custodian-contracts/bin/cli.rs) ---

/** Per-feed x402 micropayment to record on-chain: 0.1 X402 (9 decimals). */
export const PER_FEED_SPEND = "100000000";

/** Commodity symbol for the price feed. */
export const COMMODITY = process.env.AGENT_COMMODITY ?? "coffee";

/** Journey ticks the demo runs over (0..7 inclusive => 8 ticks). */
export const DEFAULT_TICK_START = 0;
export const DEFAULT_TICK_END = 7;

/** Cap on tool-calling iterations within a single tick (runaway guard). */
export const MAX_STEPS_PER_TICK = 8;

/** OpenRouter etiquette headers (identify the app). */
export const APP_REFERER = "https://github.com/casper-agentic/custodian";
export const APP_TITLE = "Custodian RWA Agent";
