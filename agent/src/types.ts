// types.ts — shared shapes for the agent (OpenAI/OpenRouter chat + tool calling,
// the pluggable tool Backend, and structured log events for the dashboard).

/** An OpenAI-style function tool (what we send to the model). */
export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

/** A tool call the model asked us to perform. */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string }; // arguments is a JSON string
}

/** A chat message in the OpenAI/OpenRouter format. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string; // for role:"tool"
  name?: string; // for role:"tool"
}

/**
 * The tool backend the agent drives. Two implementations:
 *  - McpBackend: spawns the real custodian-mcp server (Docker -> testnet + x402).
 *  - DryBackend: in-memory simulation (offline, no Docker/testnet/facilitator).
 */
export interface Backend {
  /** The available tools as OpenAI function defs. */
  tools(): Promise<ToolDef[]>;
  /** Execute a tool; returns its textual result (JSON or "ERROR: ..."). */
  call(name: string, args: Record<string, unknown>): Promise<string>;
  /** Tear down (kill the MCP child process, etc.). */
  close(): Promise<void>;
}

/** Kinds of structured events the run logger records. */
export type LogEventType =
  | "run_start"
  | "tick_start"
  | "reasoning"
  | "feed_paid"
  | "action"
  | "spend"
  | "tick_end"
  | "settled"
  | "error"
  | "run_end";

/** One line in the run log (JSONL). The dashboard reads these. */
export interface LogEvent {
  seq: number;
  ts: string; // ISO timestamp (stamped by the caller, not in pure paths)
  type: LogEventType;
  tick?: number;
  data?: Record<string, unknown>;
}
