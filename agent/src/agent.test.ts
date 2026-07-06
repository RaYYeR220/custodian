// agent.test.ts — drive the full tick loop offline with a SCRIPTED model (no
// network) over the DryBackend, and assert it reaches Settled with feeds paid,
// spend tallied, and actions logged. Proves the pay -> reason -> act wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "./agent.js";
import { RunLogger } from "./logger.js";
import { DryBackend } from "./dry-backend.js";
import type { ChatMessage, ToolDef } from "./types.js";
import type { AssistantMessage } from "./llm.js";

let callSeq = 0;
function tcall(name: string, args: Record<string, unknown>) {
  return {
    id: `c${callSeq++}`,
    type: "function" as const,
    function: { name, arguments: JSON.stringify(args) },
  };
}

/**
 * A deterministic stand-in for the LLM. Two steps per tick:
 *  - just got the "Tick N" user prompt  -> emit feed pays + record_data_spend
 *    (+ the tick-specific action), then
 *  - just got tool results             -> emit a one-line summary (no tools).
 */
function scriptedModel(shipment: number) {
  return async (messages: ChatMessage[], _tools: ToolDef[]): Promise<AssistantMessage> => {
    const last = messages[messages.length - 1];
    if (last.role === "tool") {
      return { role: "assistant", content: "Tick handled.", tool_calls: undefined };
    }
    // role === "user": parse the tick number.
    const m = /Tick (\d+)\./.exec(typeof last.content === "string" ? last.content : "");
    const tick = m ? Number(m[1]) : 0;
    const calls = [
      tcall("pay_for_telemetry", { shipment: String(shipment), tick }),
      tcall("record_data_spend", { id: shipment, amount: "100000000" }),
      tcall("pay_for_customs", { shipment: String(shipment), tick }),
      tcall("record_data_spend", { id: shipment, amount: "100000000" }),
    ];
    if (tick === 3) calls.push(tcall("revalue", { id: shipment, new_unit_price: "5000000", new_condition_score: 70, reason_code: 1 }));
    if (tick === 5) calls.push(tcall("set_customs", { id: shipment, at_customs: true, location: "Rotterdam customs" }));
    if (tick >= 6) {
      calls.push(tcall("confirm_delivery", { id: shipment }));
      calls.push(tcall("distribute", { id: shipment }));
    }
    return { role: "assistant", content: null, tool_calls: calls };
  };
}

test("full happy-path loop reaches Settled with feeds paid + actions logged", async () => {
  const backend = new DryBackend([0]);
  const logger = new RunLogger(`test-${process.pid}-${callSeq}`);
  const status = await runAgent({
    backend,
    logger,
    shipment: 0,
    tickStart: 0,
    tickEnd: 7,
    maxSteps: 6,
    chatFn: scriptedModel(0),
    now: () => "2026-06-17T00:00:00.000Z",
  });

  assert.equal(status, "Settled");

  const events = logger.all();
  const feeds = events.filter((e) => e.type === "feed_paid");
  const actions = events.filter((e) => e.type === "action");
  const settled = events.filter((e) => e.type === "settled");

  // Stops at tick 6 (distribute -> Settled): ticks 0..6 = 7 ticks * 2 feeds.
  assert.equal(feeds.length, 14);
  assert.equal(settled.length, 1);
  // revalue (t3) + set_customs (t5) + confirm_delivery + distribute (t6)
  // + 2 record_data_spend per tick * 7 ticks = 14, total actions = 18.
  assert.equal(actions.length, 18);

  // Final on-chain (sim) state is Settled with appraised revalued down.
  const ship = JSON.parse(await backend.call("get_shipment", { id: 0 }));
  assert.equal(ship.status, "Settled");
  assert.equal(ship.appraised_value, "3500000000");
  assert.equal(ship.data_spend, "1400000000"); // 14 * 0.1 X402
});
