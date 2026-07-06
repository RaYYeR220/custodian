// server.js — zero-dependency static + API server for the Custodian dashboard.
// Serves the SPA in public/ and exposes the agent run logs (agent/runs/*.jsonl):
//   GET /api/runs            -> [{ id, mtime, size }]  (newest first)
//   GET /api/run/latest      -> { id, events: [...] }
//   GET /api/run?id=<id>     -> { id, events: [...] }
// The agent writes those JSONL logs; this is a pure renderer of them.

import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, extname, join, basename } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "public");
const RUNS_DIR = resolve(__dirname, "..", "agent", "runs");
const PORT = Number(process.env.DASH_PORT ?? 4030);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

/** List run ids (filenames without .jsonl), newest first. */
async function listRuns() {
  let files = [];
  try {
    files = await readdir(RUNS_DIR);
  } catch {
    return [];
  }
  const runs = [];
  for (const f of files) {
    if (!f.endsWith(".jsonl")) continue;
    const s = await stat(join(RUNS_DIR, f));
    runs.push({ id: basename(f, ".jsonl"), mtime: s.mtimeMs, size: s.size });
  }
  runs.sort((a, b) => b.mtime - a.mtime);
  return runs;
}

/** Parse one run's JSONL into an event array. */
async function readRun(id) {
  // Guard against path traversal — id must be a bare run name.
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error("bad run id");
  const text = await readFile(join(RUNS_DIR, `${id}.jsonl`), "utf8");
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      /* skip a partial trailing line */
    }
  }
  return events;
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;

    if (p === "/api/runs") return sendJson(res, 200, await listRuns());

    if (p === "/api/run/latest") {
      const runs = await listRuns();
      if (!runs.length) return sendJson(res, 404, { error: "no runs yet" });
      const id = runs[0].id;
      return sendJson(res, 200, { id, events: await readRun(id) });
    }

    if (p === "/api/run") {
      const id = url.searchParams.get("id");
      if (!id) return sendJson(res, 400, { error: "id required" });
      return sendJson(res, 200, { id, events: await readRun(id) });
    }

    return serveStatic(res, p);
  } catch (e) {
    sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`Custodian dashboard -> http://localhost:${PORT}`);
  console.log(`reading runs from ${RUNS_DIR}`);
});
