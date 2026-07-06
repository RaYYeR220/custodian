// feeds.ts — wrapper around the PROVEN x402 Go client (Plan 2). Each feed tool
// pays an x402 micropayment (settled on Casper testnet in the X402 CEP-18 token)
// and returns the data point. We shell `go run ./client-fetch` inside golang:1.25
// with the SAME env as x402/feeds/run-feeds.sh.
//
// RUNTIME DEPENDENCY: these tools require the x402 facilitator (:4022) and the
// feed server (:4023) to be RUNNING and reachable from inside the container.
// The MCP server does NOT start them. Bring them up with:
//   docker run ... golang:1.25 bash /work/x402/feeds/run-feeds.sh   (e2e demo)
// or run the facilitator + `go run ./server` as long-lived services.
//
// Network note: when the facilitator/server run on the host (or in another
// container), set FEEDS_FACILITATOR_URL / FEEDS_SERVER_URL to reachable hosts
// (e.g. http://host.docker.internal:4022). Defaults assume same-container.

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", ".."); // dist -> mcp -> repo root

const GO_IMAGE = "golang:1.25";

// Defaults mirror x402/feeds/run-feeds.sh (the proven config).
const env = (k: string, d: string) => process.env[k] ?? d;

const FACILITATOR_URL = env("FEEDS_FACILITATOR_URL", "http://localhost:4022");
const SERVER_URL = env("FEEDS_SERVER_URL", "http://localhost:4023");
const PAYEE_ADDRESS = env(
  "FEEDS_PAYEE_ADDRESS",
  "00eb46ac01d8757f8e09b9fc454aa90ffeb9fc54a267b9775bc4bfa81ee09a4c67"
);
const CAIP2_CHAIN_ID = env("CAIP2_CHAIN_ID", "casper:casper-test");
const ASSET_PACKAGE = env(
  "FEEDS_ASSET_PACKAGE",
  "265ee18c6883e72c6a4ad5ea5a9486f727b57c741f7cd6203c29cbe72b0f59bd"
);
const ASSET_NAME = env("FEEDS_ASSET_NAME", "Casper X402 Token");

export interface FeedResult {
  status: number;
  /** Settlement tx hash on Casper testnet (empty if header absent). */
  tx: string;
  /** The decoded feed JSON payload. */
  data: unknown;
}

/**
 * Pay for and fetch one gated feed endpoint.
 * `path` is the full gated path incl. query (e.g. "/telemetry?shipment=0&tick=3").
 * Runs the Go client in golang:1.25 with the project mounted at /work and the
 * keys mounted read-only at /keys (so .keys/secret_key.pem is the x402 payer).
 */
function payAndFetch(path: string): Promise<FeedResult> {
  const dockerArgs = [
    "run",
    "--rm",
    "-v",
    `${REPO_ROOT}:/work`,
    "-v",
    `${REPO_ROOT}/.keys:/keys:ro`,
    "-v",
    "go-mod-cache:/go/pkg/mod",
    "-v",
    "go-build-cache:/root/.cache/go-build",
    "--add-host",
    "host.docker.internal:host-gateway",
    "-e",
    `FEEDS_PATH=${path}`,
    "-e",
    `FACILITATOR_URL=${FACILITATOR_URL}`,
    "-e",
    `FEEDS_SERVER_URL=${SERVER_URL}`,
    "-e",
    `PAYEE_ADDRESS=${PAYEE_ADDRESS}`,
    "-e",
    `CAIP2_CHAIN_ID=${CAIP2_CHAIN_ID}`,
    "-e",
    `ASSET_PACKAGE=${ASSET_PACKAGE}`,
    "-e",
    `ASSET_NAME=${ASSET_NAME}`,
    "-e",
    "CLIENT_PRIVATE_KEY_PATH=/keys/secret_key.pem",
    "-e",
    "CLIENT_KEY_ALGO=ed25519",
    "-w",
    "/work/x402/feeds",
    GO_IMAGE,
    "go",
    "run",
    "./client-fetch",
  ];

  return new Promise((resolvePromise, reject) => {
    execFile(
      "docker",
      dockerArgs,
      { maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        // The Go client prints exactly one JSON line on success; progress -> stderr.
        const line = lastJsonLine(stdout);
        if (line) {
          try {
            resolvePromise(JSON.parse(line) as FeedResult);
            return;
          } catch {
            /* fall through to error */
          }
        }
        reject(
          new Error(
            `x402 feed fetch (${path}) failed — is the facilitator (:4022) + ` +
              `feed server (:4023) running and reachable?\n` +
              (stderr || stdout || (err ? String(err) : "")).slice(-1800)
          )
        );
      }
    );
  });
}

/** Return the last line of stdout that parses as a JSON object. */
function lastJsonLine(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("{")) return lines[i];
  }
  return null;
}

export function payForTelemetry(shipment: string, tick: number): Promise<FeedResult> {
  return payAndFetch(
    `/telemetry?shipment=${encodeURIComponent(shipment)}&tick=${tick}`
  );
}

export function payForPrice(commodity: string, tick: number): Promise<FeedResult> {
  return payAndFetch(
    `/price?commodity=${encodeURIComponent(commodity)}&tick=${tick}`
  );
}

export function payForCustoms(shipment: string, tick: number): Promise<FeedResult> {
  return payAndFetch(
    `/customs?shipment=${encodeURIComponent(shipment)}&tick=${tick}`
  );
}
