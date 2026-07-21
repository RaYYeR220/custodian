// agent.ts — the load-bearing loop: per journey tick the agent pays x402 for
// data, reasons over it + on-chain state with the LLM, and acts on-chain. The
// model is given the Custodian Agent Skill (mcp/SKILL.md) as its system prompt
// and the MCP tools as function tools, then drives the tick autonomously.
//
// `chatFn` and `now` are injectable so the loop is testable offline (scripted
// LLM + DryBackend) without touching the network or the chain.

import { chat } from "./llm.js";
import type { AssistantMessage } from "./llm.js";
import type { Backend, ChatMessage, ToolDef } from "./types.js";
import type { RunLogger } from "./logger.js";
import { loadSkill } from "./skill.js";
import { parseToolArgs, tallySpend } from "./convert.js";
import { COMMODITY, MAX_STEPS_PER_TICK, PER_FEED_SPEND } from "./config.js";

/** Mutating contract actions (logged as on-chain actions). */
const ACTION_TOOLS = new Set([
  "revalue",
  "flag_delay",
  "set_customs",
  "confirm_delivery",
  "distribute",
  "report_loss",
  "trigger_insurance",
  "record_data_spend",
]);

export type ChatFn = (messages: ChatMessage[], tools: ToolDef[]) => Promise<AssistantMessage>;

export interface RunOpts {
  backend: Backend;
  logger: RunLogger;
  shipment: number;
  tickStart: number;
  tickEnd: number;
  maxSteps?: number;
  /** Shipment key passed to the x402 feed tools (default String(shipment);
   *  set to "loss" to exercise the silent-telemetry / insurance branch). */
  feedShipment?: string;
  /** Optional extra instruction appended to every tick prompt (used by the eval). */
  tickHint?: string;
  /** Injectable LLM (defaults to the real OpenRouter chat). */
  chatFn?: ChatFn;
  /** Injectable clock (defaults to wall time). */
  now?: () => string;
}

function buildSystemPrompt(shipment: number, feedShipment: string): string {
  const skill = loadSkill();
  return (
    skill +
    "\n\n---\n\n## Autonomous operating context\n\n" +
    `You are running fully autonomously (no human in the loop) as the operator of shipment id ${shipment}. ` +
    "Work one journey tick at a time. At each tick:\n" +
    `1. Pay for the data you need via the feed tools (telemetry + customs every tick; price (commodity='${COMMODITY}') when a market check is useful). For these feed tools pass shipment="${feedShipment}" and the current tick number.\n` +
    `2. After EACH pay_for_* call, record the cost on-chain with record_data_spend(id=${shipment}, amount="${PER_FEED_SPEND}").\n` +
    "3. Read the relevant on-chain state if needed, reason over the readings + the decision rules above, and take exactly the warranted on-chain action(s) — no more, no less.\n" +
    "4. Finish the tick by replying with a one-line summary and NO tool call.\n\n" +
    "All monetary amounts are CSPR motes (decimal strings). Never act on a shipment whose status forbids it (read get_status if unsure). Once a shipment is Settled, stop."
  );
}

/** Run the agent over the journey. Returns the final shipment status. */
export async function runAgent(opts: RunOpts): Promise<string> {
  const { backend, logger, shipment } = opts;
  const maxSteps = opts.maxSteps ?? MAX_STEPS_PER_TICK;
  const feedShipment = opts.feedShipment ?? String(shipment);
  const chatFn: ChatFn = opts.chatFn ?? ((m, t) => chat(m, t));
  const now = opts.now ?? (() => new Date().toISOString());

  const tools = await backend.tools();
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(shipment, feedShipment) },
  ];

  const initial = await readShipment(backend, shipment);
  logger.event("run_start", now(), undefined, {
    shipment,
    ticks: `${opts.tickStart}-${opts.tickEnd}`,
    tools: tools.length,
    state: initial ?? undefined,
  });

  let status = (initial?.status as string) ?? "InTransit";

  for (let tick = opts.tickStart; tick <= opts.tickEnd; tick++) {
    logger.event("tick_start", now(), tick);
    messages.push({
      role: "user",
      content:
        `Tick ${tick}. Acquire the data you need for shipment ${shipment} at this tick, ` +
        "reason over it and the current on-chain state, and take the appropriate on-chain action(s). " +
        "When done, reply with a one-line summary and stop." +
        (opts.tickHint ? " " + opts.tickHint : ""),
    });

    for (let step = 0; step < maxSteps; step++) {
      const a = await chatFn(messages, tools);
      messages.push({ role: "assistant", content: a.content, tool_calls: a.tool_calls });

      if (a.tool_calls && a.tool_calls.length > 0) {
        for (const tc of a.tool_calls) {
          const name = tc.function.name;
          const args = parseToolArgs(tc.function.arguments);
          let result: string;
          try {
            result = await backend.call(name, args);
          } catch (e) {
            result = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
          }

          if (name.startsWith("pay_for_")) {
            logger.event("feed_paid", now(), tick, {
              tool: name,
              args,
              amount: PER_FEED_SPEND,
              result: clip(result),
            });
          } else if (ACTION_TOOLS.has(name)) {
            logger.event("action", now(), tick, { tool: name, args, result: clip(result) });
          }
          // reads are free + noisy — executed and fed back, not logged.

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name,
            content: result,
          });
        }
        continue; // let the model see the tool results
      }

      // No tool calls => the model's tick summary.
      if (a.content) logger.event("reasoning", now(), tick, { summary: a.content });
      break;
    }

    // Snapshot on-chain state so the dashboard can render accurately.
    const snap = await readShipment(backend, shipment);
    if (snap?.status) status = snap.status as string;
    logger.event("tick_end", now(), tick, {
      spend: tallySpend(logger.all()),
      status,
      metadata: snap?.metadata,
      appraised_value: snap?.appraised_value,
      condition_score: snap?.condition_score,
      escrow: snap?.escrow,
      at_customs: snap?.at_customs,
      data_spend: snap?.data_spend,
    });

    // Stop early once the shipment is settled.
    if (status === "Settled") {
      logger.event("settled", now(), tick, { status });
      break;
    }
  }

  logger.event("run_end", now(), undefined, {
    status,
    total_data_spend: tallySpend(logger.all()),
  });
  return status;
}

/** Best-effort full shipment read (for snapshots); null if it fails. */
async function readShipment(
  backend: Backend,
  shipment: number
): Promise<Record<string, unknown> | null> {
  try {
    const res = await backend.call("get_shipment", { id: shipment });
    const parsed = JSON.parse(res) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function clip(s: string, n = 400): string {
  return s.length > n ? s.slice(0, n - 3) + "..." : s;
}
