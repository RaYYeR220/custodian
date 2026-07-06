// odra.ts — thin wrapper around the PROVEN odra-cli running inside the
// casper-odra:dev Docker image. Every contract read/write the agent makes goes
// through here. We do NOT reimplement on-chain plumbing; we shell the exact
// command that was validated in Plan 1 and parse its stdout.
//
// Read:   prints `Call result: { ...json... }`  -> we parse the JSON.
// Write:  prints `Transaction "<hash>" successfully executed.` -> we return the hash.
//
// Gotcha handled: the public node /events SSE sometimes returns 504 after a
// mutating submit; the tx usually still lands. On that failure we retry ONCE.

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/ -> mcp/ -> repo root
const REPO_ROOT = resolve(__dirname, "..", "..");

const IMAGE = "casper-odra:dev";
const MIN_GAS = 2_500_000_000; // odra-cli min for a mutating call

/** Strip ANSI color codes that odra-cli's logger emits around `Call result:`. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, "");
}

export interface OdraResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run an odra-cli sub-invocation inside the Docker image with the repo mounted
 * and cargo/target caches on named volumes (same layout as scripts/odra.ps1).
 * `cliArgs` are the args AFTER `... -- ` (e.g. ["contract","Custodian","get_shipment","--id","0"]).
 */
function runOdra(cliArgs: string[]): Promise<OdraResult> {
  const inner =
    "cargo run -q --bin custodian_contracts_cli -- " +
    cliArgs.map(shellQuote).join(" ");

  const dockerArgs = [
    "run",
    "--rm",
    "-v",
    `${REPO_ROOT}:/work`,
    "-v",
    "casper-cargo:/cargo",
    "-v",
    "casper-target:/target",
    "-e",
    "CARGO_HOME=/cargo",
    "-e",
    "CARGO_TARGET_DIR=/target",
    "-w",
    "/work/custodian-contracts",
    IMAGE,
    "sh",
    "-c",
    inner,
  ];

  return new Promise((resolvePromise) => {
    execFile(
      "docker",
      dockerArgs,
      { maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        resolvePromise({
          ok: !err,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
        });
      }
    );
  });
}

/** Quote an arg for `sh -c`. Our args are simple but metadata/location are strings. */
function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** True if the combined output looks like the flaky 504 /events SSE failure. */
function isEventsFlake(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("504") ||
    t.includes("gateway time-out") ||
    t.includes("gateway timeout") ||
    t.includes("/events")
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Shipment JSON as returned by the contract (all values are strings). */
export interface ShipmentJson {
  id: string;
  metadata: string;
  status: string;
  quantity: string;
  unit_price: string;
  condition_score: string;
  initial_value: string;
  appraised_value: string;
  escrow: string;
  insurance_coverage: string;
  at_customs: string;
  delayed: string;
  delay_penalty: string;
  data_spend: string;
  last_update: string;
  holders: string;
  shares: string;
  [k: string]: string;
}

/** Parse the `Call result:` payload. Reads print JSON (objects) or a scalar. */
function parseCallResult(stdout: string): unknown {
  const clean = stripAnsi(stdout);
  const idx = clean.indexOf("Call result:");
  if (idx === -1) {
    throw new Error(
      "odra-cli produced no 'Call result:' — output:\n" + clean.slice(-1500)
    );
  }
  const after = clean.slice(idx + "Call result:".length).trim();

  // Object result (get_shipment): take from first '{' to its matching '}'.
  if (after.startsWith("{")) {
    const end = after.lastIndexOf("}");
    const block = after.slice(0, end + 1);
    return JSON.parse(block);
  }
  // Scalar result (get_value / get_data_spend / get_status): first token/line,
  // strip surrounding quotes if present.
  const firstLine = after.split(/\r?\n/)[0].trim();
  return firstLine.replace(/^"(.*)"$/, "$1");
}

/** A contract read: `contract Custodian <method> --id <id>`. */
export async function odraRead(
  method: "get_shipment" | "get_status" | "get_value" | "get_data_spend",
  id: number
): Promise<unknown> {
  const res = await runOdra([
    "contract",
    "Custodian",
    method,
    "--id",
    String(id),
  ]);
  if (!res.ok && !res.stdout.includes("Call result:")) {
    throw new Error(
      `odra read ${method}(id=${id}) failed:\n` +
        stripAnsi(res.stderr || res.stdout).slice(-1500)
    );
  }
  return parseCallResult(res.stdout);
}

// ---------------------------------------------------------------------------
// Writes (mutating, operator-gated)
// ---------------------------------------------------------------------------

/** Pull the tx hash out of `Transaction "<hash>" successfully executed.`. */
function parseTxHash(stdout: string): string | null {
  const clean = stripAnsi(stdout);
  const m = clean.match(/Transaction\s+"?([0-9a-fA-F]{64})"?\s+successfully executed/);
  return m ? m[1] : null;
}

export interface OdraWriteResult {
  txHash: string;
  retried: boolean;
}

/**
 * A mutating contract call. `args` are the method flags WITHOUT --gas
 * (e.g. ["--id","0","--amount","100000000"]); gas is appended here.
 * Retries ONCE on the flaky /events 504 (tx usually still lands; the retry
 * re-reads success from the second attempt's output OR surfaces a clear error).
 */
export async function odraWrite(
  method: string,
  args: string[],
  gas: number
): Promise<OdraWriteResult> {
  if (gas < MIN_GAS) {
    throw new Error(`gas ${gas} below odra minimum ${MIN_GAS}`);
  }
  const cliArgs = [
    "contract",
    "Custodian",
    method,
    ...args,
    "--gas",
    String(gas),
  ];

  const first = await runOdra(cliArgs);
  let hash = parseTxHash(first.stdout);
  if (hash) return { txHash: hash, retried: false };

  // No success line. If it's the known /events flake, retry once.
  const combined = first.stdout + "\n" + first.stderr;
  if (isEventsFlake(combined)) {
    const second = await runOdra(cliArgs);
    hash = parseTxHash(second.stdout);
    if (hash) return { txHash: hash, retried: true };
    throw new Error(
      `odra write ${method} failed twice (events 504 flake). Last output:\n` +
        stripAnsi(second.stderr || second.stdout).slice(-1500)
    );
  }

  throw new Error(
    `odra write ${method} did not report success. Output:\n` +
      stripAnsi(first.stderr || first.stdout).slice(-1800)
  );
}

export const GAS = {
  simple: 5_000_000_000,
  heavy: 6_000_000_000, // distribute / trigger_insurance
} as const;
