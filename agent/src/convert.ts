// convert.ts — pure helpers (no I/O) so they are unit-testable:
//  - mcpToolToOpenAI: MCP tool descriptor -> OpenAI/OpenRouter function tool.
//  - parseToolArgs: tolerant JSON parse of a model's tool-call arguments.
//  - tallySpend: sum the x402 micropayments recorded across log events.

import type { ToolDef, LogEvent } from "./types.js";

/** Minimal shape of an MCP tool as returned by client.listTools(). */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Convert one MCP tool descriptor into an OpenAI-style function tool. MCP's
 * `inputSchema` is already JSON Schema, so it maps straight to `parameters`.
 * Falls back to an empty object schema when absent (some no-arg tools).
 */
export function mcpToolToOpenAI(tool: McpTool): ToolDef {
  const parameters =
    tool.inputSchema && typeof tool.inputSchema === "object"
      ? tool.inputSchema
      : { type: "object", properties: {} };
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters,
    },
  };
}

/** Convert a list of MCP tools. */
export function mcpToolsToOpenAI(tools: McpTool[]): ToolDef[] {
  return tools.map(mcpToolToOpenAI);
}

/**
 * Parse a model's tool-call `arguments` string into an object. Models sometimes
 * emit "" or malformed JSON for no-arg calls — treat those as {} rather than
 * crashing the loop.
 */
export function parseToolArgs(raw: string | undefined | null): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Sum the `amount` (decimal mote/unit string) of every `feed_paid` event into a
 * cumulative spend, returned as a decimal string (BigInt-safe).
 */
export function tallySpend(events: LogEvent[]): string {
  let total = 0n;
  for (const e of events) {
    if (e.type !== "feed_paid") continue;
    const amt = e.data?.amount;
    if (typeof amt === "string" && /^\d+$/.test(amt)) total += BigInt(amt);
  }
  return total.toString();
}
