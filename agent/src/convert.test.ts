// convert.test.ts — pure-function tests (node:test). Run: node --test dist/*.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mcpToolToOpenAI,
  mcpToolsToOpenAI,
  parseToolArgs,
  tallySpend,
} from "./convert.js";
import type { LogEvent } from "./types.js";

test("mcpToolToOpenAI maps name/description/inputSchema -> function tool", () => {
  const schema = {
    type: "object",
    properties: { id: { type: "number" } },
    required: ["id"],
  };
  const t = mcpToolToOpenAI({
    name: "get_shipment",
    description: "Read a shipment.",
    inputSchema: schema,
  });
  assert.equal(t.type, "function");
  assert.equal(t.function.name, "get_shipment");
  assert.equal(t.function.description, "Read a shipment.");
  assert.deepEqual(t.function.parameters, schema);
});

test("mcpToolToOpenAI defaults parameters to empty object schema", () => {
  const t = mcpToolToOpenAI({ name: "noargs" });
  assert.deepEqual(t.function.parameters, { type: "object", properties: {} });
});

test("mcpToolsToOpenAI converts a list", () => {
  const out = mcpToolsToOpenAI([{ name: "a" }, { name: "b" }]);
  assert.equal(out.length, 2);
  assert.equal(out[0].function.name, "a");
  assert.equal(out[1].function.name, "b");
});

test("parseToolArgs handles valid, empty, and malformed input", () => {
  assert.deepEqual(parseToolArgs('{"id":3}'), { id: 3 });
  assert.deepEqual(parseToolArgs(""), {});
  assert.deepEqual(parseToolArgs("   "), {});
  assert.deepEqual(parseToolArgs(undefined), {});
  assert.deepEqual(parseToolArgs("not json"), {});
  assert.deepEqual(parseToolArgs("42"), {}); // non-object -> {}
});

test("tallySpend sums feed_paid amounts (BigInt-safe)", () => {
  const events: LogEvent[] = [
    { seq: 1, ts: "t", type: "feed_paid", data: { amount: "100000000" } },
    { seq: 2, ts: "t", type: "action", data: { amount: "999" } }, // ignored
    { seq: 3, ts: "t", type: "feed_paid", data: { amount: "100000000" } },
    { seq: 4, ts: "t", type: "feed_paid", data: { amount: "bad" } }, // ignored
  ];
  assert.equal(tallySpend(events), "200000000");
  assert.equal(tallySpend([]), "0");
});
