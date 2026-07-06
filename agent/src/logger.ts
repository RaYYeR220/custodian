// logger.ts — structured run log. Every run appends JSONL to agent/runs/<runId>.jsonl
// (the Plan 5 dashboard reads these) and pretty-prints to the console. Events
// carry a monotonic seq + an ISO ts supplied by the caller.

import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { AGENT_DIR } from "./config.js";
import type { LogEvent, LogEventType } from "./types.js";

export class RunLogger {
  readonly runId: string;
  readonly file: string;
  private seq = 0;
  private events: LogEvent[] = [];

  constructor(runId: string) {
    this.runId = runId;
    const dir = resolve(AGENT_DIR, "runs");
    mkdirSync(dir, { recursive: true });
    // The run id is built from CLI args — sanitize to a bare filename so it can
    // never influence the path outside the runs dir.
    const safe = runId.replace(/[^A-Za-z0-9._-]/g, "-");
    this.file = resolve(dir, `${safe}.jsonl`);
  }

  /** Record one event. `ts` is the real timestamp the caller stamps. */
  event(type: LogEventType, ts: string, tick: number | undefined, data?: Record<string, unknown>): LogEvent {
    const e: LogEvent = { seq: ++this.seq, ts, type, tick, data };
    this.events.push(e);
    appendFileSync(this.file, JSON.stringify(e) + "\n");
    this.pretty(e);
    return e;
  }

  /** All events recorded so far (for spend tallies / summaries). */
  all(): LogEvent[] {
    return this.events;
  }

  private pretty(e: LogEvent): void {
    const t = e.tick !== undefined ? `[t${e.tick}] ` : "";
    const d = e.data ? " " + summarize(e.data) : "";
    // stderr so a future stdout-piped mode stays clean.
    console.error(`${t}${e.type}${d}`);
  }
}

/** Compact one-line view of an event's data for the console. */
function summarize(data: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    let s = typeof v === "string" ? v : JSON.stringify(v);
    if (s.length > 140) s = s.slice(0, 137) + "...";
    parts.push(`${k}=${s}`);
  }
  return parts.join(" ");
}
