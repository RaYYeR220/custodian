// Graded eval runner. Runs the REAL agent (LLM reasoning over a simulated chain)
// against each decision scenario, scores the on-chain action it chose against a
// hidden answer key, and writes a scorecard (EVAL.md + eval-results.json).
//
//   npm run build && npm run eval
//
// This is the agent's report card: it proves the agent takes the correct
// operator action in each situation — and refuses the wrong ones.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runAgent } from "../agent.js";
import { DryBackend } from "../dry-backend.js";
import { RunLogger } from "../logger.js";
import { REPO_ROOT, MODEL, OPENROUTER_API_KEY } from "../config.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";

const VALUE_ACTIONS = new Set([
  "revalue", "flag_delay", "set_customs", "confirm_delivery",
  "distribute", "report_loss", "trigger_insurance",
]);

interface Result {
  id: string;
  title: string;
  situation: string;
  expected: string[];
  taken: string[];
  missing: string[];
  wrong: string[];
  pass: boolean;
}

async function runScenario(s: Scenario): Promise<Result> {
  const backend = new DryBackend([0], { priceSpike: s.priceSpike, priceSpikeFromTick: s.priceSpikeFromTick });
  const logger = new RunLogger(`eval-${s.id}-${Date.now()}`);
  await runAgent({
    backend,
    logger,
    shipment: 0,
    tickStart: s.tickStart ?? s.tick,
    tickEnd: s.tick,
    maxSteps: 8,
    feedShipment: s.feedShipment,
    tickHint: s.tickHint,
  });
  await backend.close();

  // grade the decision at the KEY tick (prior ticks only provide context)
  const taken = [
    ...new Set(
      logger
        .all()
        .filter((e) => e.type === "action" && e.tick === s.tick)
        .map((e) => String((e.data as Record<string, unknown>)?.tool))
        .filter((t) => VALUE_ACTIONS.has(t))
    ),
  ];
  const took = new Set(taken);
  const missing = s.expected.filter((a) => !took.has(a));
  const wrong = s.forbidden.filter((a) => took.has(a));
  return {
    id: s.id, title: s.title, situation: s.situation,
    expected: s.expected, taken, missing, wrong,
    pass: missing.length === 0 && wrong.length === 0,
  };
}

function actionText(taken: string[], expected: string[]): string {
  if (!taken.length) return expected.length === 0 ? "no action (correct)" : "no action";
  return taken.join(", ");
}

function toMarkdown(results: Result[], passed: number, stamp: string): string {
  const rows = results
    .map((r) => {
      const mark = r.pass ? "✅" : "❌";
      const exp = r.expected.length ? r.expected.join(", ") : "no action";
      return `| ${mark} | ${r.title} | ${r.situation} | ${exp} | ${actionText(r.taken, r.expected)} |`;
    })
    .join("\n");
  return `# Custodian agent — decision eval

The agent is graded on the **on-chain action it chooses** in each situation,
against a hidden answer key. It runs the real reasoning model
(\`${MODEL}\`) over a simulated chain — so this measures judgment, not luck.

**Score: ${passed}/${results.length} scenarios — correct action, no wrong action.**
_Generated ${stamp}._

| | Scenario | Situation | Expected | Agent chose |
|---|---|---|---|---|
${rows}

Run it yourself: \`cd agent && npm install && npm run build && npm run eval\`.
Each row is one live agent decision; "no action (correct)" means the agent
correctly did nothing when nothing was wrong (and refused every destructive
action). Full machine-readable results: \`agent/eval-results.json\`.
`;
}

async function main(): Promise<void> {
  if (!OPENROUTER_API_KEY) {
    console.error("FATAL: OPENROUTER_API_KEY not set (repo-root .env).");
    process.exit(1);
  }
  console.error(`Custodian decision eval — model ${MODEL} — ${SCENARIOS.length} scenarios\n`);
  const results: Result[] = [];
  for (const s of SCENARIOS) {
    console.error(`\n=== ${s.id}: ${s.title} ===`);
    results.push(await runScenario(s));
  }
  const passed = results.filter((r) => r.pass).length;
  const stamp = new Date().toISOString().slice(0, 10);

  writeFileSync(resolve(REPO_ROOT, "agent", "eval-results.json"), JSON.stringify({ model: MODEL, stamp, passed, total: results.length, results }, null, 2));
  writeFileSync(resolve(REPO_ROOT, "EVAL.md"), toMarkdown(results, passed, stamp));

  console.error(`\n────────────────────────────────`);
  for (const r of results) console.error(`${r.pass ? "PASS" : "FAIL"}  ${r.id.padEnd(11)} chose: ${r.taken.join(", ") || "(none)"}${r.missing.length ? `  missing: ${r.missing.join(",")}` : ""}${r.wrong.length ? `  wrong: ${r.wrong.join(",")}` : ""}`);
  console.error(`────────────────────────────────`);
  console.error(`SCORE: ${passed}/${results.length}\n`);
  process.exitCode = passed === results.length ? 0 : 1;
}

main().catch((e) => {
  console.error("eval failed:", e);
  process.exit(1);
});
