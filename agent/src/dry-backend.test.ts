// dry-backend.test.ts — the offline simulation must match the live journey +
// contract behaviour. Run: node --test dist/*.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { DryBackend } from "./dry-backend.js";

async function callJson(b: DryBackend, name: string, args: Record<string, unknown>) {
  return JSON.parse(await b.call(name, args));
}

test("telemetry tick 3 is the cold-chain breach (31.4C, not lost)", async () => {
  const b = new DryBackend();
  const r = await callJson(b, "pay_for_telemetry", { shipment: "0", tick: 3 });
  assert.equal(r.status, 200);
  assert.equal(typeof r.tx, "string");
  assert.equal(r.data.temp_c, 31.4);
  assert.equal(r.data.lost, false);
});

test("customs is cleared at tick 6", async () => {
  const b = new DryBackend();
  const r = await callJson(b, "pay_for_customs", { shipment: "0", tick: 6 });
  assert.equal(r.data.at_customs, true);
  assert.equal(r.data.cleared, true);
});

test("loss variant telemetry reports lost:true", async () => {
  const b = new DryBackend();
  const r = await callJson(b, "pay_for_telemetry", { shipment: "loss", tick: 4 });
  assert.equal(r.data.lost, true);
  assert.equal(r.data.temp_c, 0);
});

test("revalue to score 70 recomputes appraised to 3.5 CSPR", async () => {
  const b = new DryBackend();
  await callJson(b, "revalue", { id: 0, new_unit_price: "5000000", new_condition_score: 70, reason_code: 1 });
  const v = await callJson(b, "get_value", { id: 0 });
  assert.equal(v.appraised_value, "3500000000");
});

test("happy-path settlement: confirm_delivery then distribute -> Settled, payout capped at escrow", async () => {
  const b = new DryBackend();
  await callJson(b, "confirm_delivery", { id: 0 });
  const d = await callJson(b, "distribute", { id: 0 });
  assert.equal(d.payout, "5000000000"); // appraised 5 CSPR <= escrow 5 CSPR
  const s = await callJson(b, "get_status", { id: 0 });
  assert.equal(s.status, "Settled");
});

test("distribute requires Delivered (guard like the contract)", async () => {
  const b = new DryBackend();
  const out = await b.call("distribute", { id: 0 }); // still InTransit
  assert.match(out, /ERROR: InvalidStatus/);
});

test("loss path: report_loss then trigger_insurance -> Settled, pays insurance", async () => {
  const b = new DryBackend();
  await callJson(b, "report_loss", { id: 0 });
  const ins = await callJson(b, "trigger_insurance", { id: 0 });
  assert.equal(ins.payout, "4000000000"); // 4 CSPR insurance <= escrow
  const s = await callJson(b, "get_status", { id: 0 });
  assert.equal(s.status, "Settled");
});

test("record_data_spend accumulates", async () => {
  const b = new DryBackend();
  await callJson(b, "record_data_spend", { id: 0, amount: "100000000" });
  await callJson(b, "record_data_spend", { id: 0, amount: "100000000" });
  const ds = await callJson(b, "get_data_spend", { id: 0 });
  assert.equal(ds.data_spend, "200000000");
});

test("tools() exposes the 15-tool surface", async () => {
  const b = new DryBackend();
  const tools = await b.tools();
  assert.equal(tools.length, 15);
  const names = tools.map((t) => t.function.name);
  assert.ok(names.includes("pay_for_telemetry"));
  assert.ok(names.includes("distribute"));
});
