#!/usr/bin/env node
// index.ts — CLI entry for the Custodian agent.
//
//   npm run dry                         # offline: real LLM, simulated chain
//   npm start -- --shipment 1           # live: real x402 + real on-chain actions
//   npm start -- --shipment 1 --ticks 0-7 --max-steps 8
//
// Flags:
//   --dry-run            use the in-memory DryBackend (no Docker/testnet/x402)
//   --shipment <id>      shipment id to manage (default 0)
//   --ticks <a-b>        journey tick range, inclusive (default 0-7)
//   --max-steps <n>      tool-call cap per tick (default 8)

import { runAgent } from "./agent.js";
import { RunLogger } from "./logger.js";
import { DryBackend } from "./dry-backend.js";
import { McpBackend } from "./backend.js";
import { OPENROUTER_API_KEY, MODEL, DEFAULT_TICK_START, DEFAULT_TICK_END } from "./config.js";
import type { Backend } from "./types.js";

interface Args {
  dryRun: boolean;
  shipment: number;
  tickStart: number;
  tickEnd: number;
  maxSteps?: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    dryRun: false,
    shipment: 0,
    tickStart: DEFAULT_TICK_START,
    tickEnd: DEFAULT_TICK_END,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") a.dryRun = true;
    else if (arg === "--shipment") a.shipment = Number(argv[++i]);
    else if (arg === "--max-steps") a.maxSteps = Number(argv[++i]);
    else if (arg === "--ticks") {
      const [lo, hi] = argv[++i].split("-").map(Number);
      a.tickStart = lo;
      a.tickEnd = hi ?? lo;
    }
  }
  return a;
}

function runId(args: Args): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${args.dryRun ? "dry" : "live"}-ship${args.shipment}-${stamp}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!OPENROUTER_API_KEY) {
    console.error(
      "FATAL: OPENROUTER_API_KEY is not set. Put it in the repo-root .env (gitignored)."
    );
    process.exit(1);
  }

  const logger = new RunLogger(runId(args));
  const backend: Backend = args.dryRun ? new DryBackend([args.shipment]) : new McpBackend();

  console.error(
    `Custodian agent — ${args.dryRun ? "DRY-RUN (simulated chain)" : "LIVE (testnet)"} | ` +
      `model ${MODEL} | shipment ${args.shipment} | ticks ${args.tickStart}-${args.tickEnd}`
  );
  console.error(`run log: ${logger.file}\n`);

  try {
    const status = await runAgent({
      backend,
      logger,
      shipment: args.shipment,
      tickStart: args.tickStart,
      tickEnd: args.tickEnd,
      maxSteps: args.maxSteps,
    });
    console.error(`\nFinished. Final status: ${status}`);
  } catch (e) {
    logger.event("error", new Date().toISOString(), undefined, {
      message: e instanceof Error ? e.message : String(e),
    });
    console.error("\nFATAL:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await backend.close();
  }
}

main();
