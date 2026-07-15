// app.js — renders an agent run log as a live shipment dashboard. Pure renderer:
// it derives all state by replaying the JSONL events the agent wrote.

const CSPR = 1e9;
const X402 = 1e9; // X402 token has 9 decimals
const CSPR_LIVE = "https://testnet.cspr.live/transaction/";

const fmtCspr = (m) => (Number(m) / CSPR).toFixed(3);
const fmtX402 = (u) => (Number(u) / X402).toFixed(1);
const shortHash = (h) => (h && h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h || "");

const $ = (id) => document.getElementById(id);
const els = {
  runSelect: $("runSelect"), replayBtn: $("replayBtn"), allBtn: $("allBtn"), liveToggle: $("liveToggle"),
  simBanner: $("simBanner"), statusPill: $("statusPill"), metadata: $("metadata"),
  appraised: $("appraised"), condition: $("condition"), conditionBar: $("conditionBar"),
  escrow: $("escrow"), tick: $("tick"), routeDot: $("routeDot"),
  reading: $("reading"), readingText: $("readingText"),
  spend: $("spend"), payCount: $("payCount"), spendNum: document.querySelector(".spend-num"),
  logList: $("logList"), runId: $("runId"),
};

let runIdCur = null;
let simulated = false;
let playToken = 0; // cancels an in-flight replay when a new action starts
let liveTimer = null;
let appliedSeq = 0; // for live tail-application

// --- derived view state ---
function freshView() {
  return { quantity: 1000, status: "—", appraised: "0", condition: "100", escrow: "0",
    insurance: "0", tick: null, spend: 0, payCount: 0 };
}
let view = freshView();

// ---------------------------------------------------------------------------
// Event application
// ---------------------------------------------------------------------------
function applyEvent(e, animate) {
  switch (e.type) {
    case "run_start": {
      const s = e.data?.state;
      if (s) {
        view.quantity = Number(s.quantity) || 1000;
        view.status = s.status; view.appraised = s.appraised_value;
        view.condition = s.condition_score; view.escrow = s.escrow;
        view.insurance = s.insurance_coverage ?? "0";
        view.metadata = s.metadata;
      }
      renderCard();
      break;
    }
    case "tick_start":
      view.tick = e.tick; renderTick(); break;

    case "feed_paid": {
      view.spend += Number(e.data?.amount || 0); view.payCount++;
      const r = safeParse(e.data?.result);
      const tool = e.data?.tool || "";
      logRow({
        cls: "pay", tk: e.tick, chip: "PAY", title: feedLabel(tool),
        sub: readingSummary(tool, r?.data), tx: r?.tx,
        breach: tool === "pay_for_telemetry" && Number(r?.data?.temp_c) > 25,
      });
      if (tool === "pay_for_telemetry" && r?.data) updateReading(r.data);
      renderSpend(animate);
      break;
    }
    case "action": {
      const r = safeParse(e.data?.result);
      const tool = e.data?.tool || ""; const args = e.data?.args || {};
      // snappy local update for revalue
      if (tool === "revalue") {
        view.condition = String(args.new_condition_score);
        view.appraised = String(
          Math.floor((view.quantity * Number(args.new_unit_price) * Number(args.new_condition_score)) / 100)
        );
        renderCard();
      }
      // The live MCP distribute/trigger_insurance result carries no `payout`
      // field — derive the on-chain payout (capped at escrow) from current state
      // so the log shows the real amount, not 0.
      let title = actionLabel(tool, args, r);
      if (tool === "distribute" && !(r && r.payout)) {
        title = `Distributed ${fmtCspr(Math.min(Number(view.appraised), Number(view.escrow)))} CSPR to holders`;
      } else if (tool === "trigger_insurance" && !(r && r.payout)) {
        title = `Triggered insurance — ${fmtCspr(Math.min(Number(view.insurance), Number(view.escrow)))} CSPR`;
      }
      logRow({
        cls: "act", tk: e.tick, chip: "ACT", title,
        sub: r?.action ? `on-chain · ${r.action}` : "on-chain", tx: r?.txHash,
        breach: tool === "report_loss",
      });
      break;
    }
    case "reasoning":
      logRow({ cls: "evt", tk: e.tick, chip: "AGENT", title: e.data?.summary || "reasoning", sub: "Gemini" });
      break;

    case "tick_end": {
      const d = e.data || {};
      if (d.status) view.status = d.status;
      if (d.appraised_value) view.appraised = d.appraised_value;
      if (d.condition_score) view.condition = d.condition_score;
      if (d.escrow) view.escrow = d.escrow;
      view.atCustoms = d.at_customs === "true";
      renderCard(); renderTick();
      break;
    }
    case "settled":
      view.status = "Settled"; renderCard();
      logRow({ cls: "settle", tk: e.tick, chip: "DONE", title: "Shipment settled — proceeds distributed", sub: "lifecycle complete" });
      break;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderCard() {
  els.metadata.textContent = view.metadata || "—";
  els.appraised.textContent = fmtCspr(view.appraised);
  els.escrow.textContent = fmtCspr(view.escrow);
  const cond = Number(view.condition);
  els.condition.textContent = cond;
  els.conditionBar.style.width = `${Math.max(0, Math.min(100, cond))}%`;
  els.conditionBar.classList.toggle("low", cond < 85);

  els.statusPill.textContent = view.status;
  els.statusPill.className = `pill ${view.status}`;
  renderLifecycle();
}

function renderTick() {
  els.tick.textContent = view.tick ?? "—";
  const t = Math.max(0, Math.min(7, Number(view.tick) || 0));
  els.routeDot.style.left = `${(t / 7) * 100}%`;
}

function renderSpend(animate) {
  els.spend.textContent = fmtX402(view.spend);
  els.payCount.textContent = view.payCount;
  if (animate) {
    els.spendNum.classList.remove("bump");
    void els.spendNum.offsetWidth; // reflow to restart animation
    els.spendNum.classList.add("bump");
  }
}

function updateReading(d) {
  const breach = Number(d.temp_c) > 25;
  els.reading.classList.toggle("breach", breach);
  if (d.lost) {
    els.readingText.textContent = "⚠ telemetry & GPS silent — cargo presumed lost";
  } else {
    els.readingText.textContent = `${d.temp_c}°C · ${d.note || ""} · ${d.lat}, ${d.lon}`;
  }
}

function renderLifecycle() {
  const order = ["InTransit", "Delivered", "Settled"];
  const lost = view.status === "Lost";
  const idx = order.indexOf(view.status);
  document.querySelectorAll(".lifecycle .step").forEach((el) => {
    const step = el.dataset.step;
    el.classList.remove("active", "done");
    if (step === view.status) el.classList.add("active");
    else if (!lost && idx > -1 && order.indexOf(step) > -1 && order.indexOf(step) < idx) el.classList.add("done");
    if (lost && step === "Lost") el.classList.add("active");
  });
}

// Build rows with DOM nodes + textContent (no innerHTML) so LLM/feed-derived
// strings can never inject markup.
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function logRow({ cls, tk, chip, title, sub, tx, breach }) {
  const row = el("div", `log-row ${cls}${breach ? " breach" : ""}${cls === "settle" ? " settle" : ""}`);
  const chipCls = cls === "pay" ? "pay" : cls === "act" || cls === "settle" ? "act" : "evt";

  row.appendChild(el("div", "tk", `t${tk ?? "·"}`));

  const body = el("div", "body");
  const titleDiv = el("div", "title");
  titleDiv.appendChild(el("span", `chip ${chipCls}`, chip));
  titleDiv.appendChild(document.createTextNode(String(title)));
  body.appendChild(titleDiv);
  body.appendChild(el("div", "sub", sub || ""));
  row.appendChild(body);

  if (tx) {
    const a = el("a", `tx${simulated ? " dead" : ""}`, `${shortHash(tx)} ↗`);
    a.href = CSPR_LIVE + encodeURIComponent(tx);
    a.target = "_blank";
    a.rel = "noopener";
    a.title = simulated ? "simulated tx" : tx;
    row.appendChild(a);
  } else {
    row.appendChild(el("span", "tx dead"));
  }

  els.logList.appendChild(row);
  els.logList.scrollTop = els.logList.scrollHeight;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------
function feedLabel(tool) {
  return { pay_for_telemetry: "Paid for telemetry feed", pay_for_price: "Paid for price feed",
    pay_for_customs: "Paid for customs feed" }[tool] || tool;
}
function readingSummary(tool, d) {
  if (!d) return "x402 micropayment settled";
  if (tool === "pay_for_telemetry") return d.lost ? "lost: true" : `${d.temp_c}°C · ${d.note || ""}`;
  if (tool === "pay_for_price") return `${d.unit_price} ${d.currency || ""}`;
  if (tool === "pay_for_customs") return `${d.location} · ${d.cleared ? "cleared" : d.at_customs ? "at customs" : "in transit"}`;
  return "x402 micropayment settled";
}
function actionLabel(tool, a, r) {
  switch (tool) {
    case "revalue": return `Revalued → condition ${a.new_condition_score}/100 (reason ${a.reason_code})`;
    case "flag_delay": return `Flagged delay (+${fmtCspr(a.penalty)} CSPR penalty)`;
    case "set_customs": return `Customs: ${a.location} (${a.at_customs ? "held" : "released"})`;
    case "confirm_delivery": return "Confirmed delivery";
    case "distribute": return `Distributed ${fmtCspr(r?.payout || 0)} CSPR to holders`;
    case "report_loss": return "Reported loss";
    case "trigger_insurance": return `Triggered insurance — ${fmtCspr(r?.payout || 0)} CSPR`;
    case "record_data_spend": return `Recorded data spend on-chain (+${fmtX402(a.amount)} X402)`;
    default: return tool;
  }
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------
function resetView() {
  view = freshView();
  els.logList.innerHTML = "";
  renderCard(); renderTick(); renderSpend(false);
  els.reading.classList.remove("breach");
  els.readingText.textContent = "awaiting telemetry…";
}

function showAll(events) {
  playToken++; // cancel any replay
  resetView();
  for (const e of events) applyEvent(e, false);
  appliedSeq = events.length ? events[events.length - 1].seq : 0;
}

const DELAY = { run_start: 300, tick_start: 450, feed_paid: 650, action: 700, reasoning: 950, tick_end: 500, settled: 1200, run_end: 200 };

async function replay(events) {
  const token = ++playToken;
  resetView();
  for (const e of events) {
    if (token !== playToken) return; // cancelled
    applyEvent(e, true);
    await sleep(DELAY[e.type] ?? 500);
  }
  appliedSeq = events.length ? events[events.length - 1].seq : 0;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
// Source order: locally (npm start) prefer the live server API; on a static host
// (GitHub Pages, etc.) prefer the bundled snapshot first — so neither environment
// logs a 404 for the source it doesn't have.
const IS_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(location.hostname);
const src = (api, stat) => (IS_LOCAL ? [api, stat] : [stat, api]);

// Fetch the first URL that responds OK. Lets the dashboard work both live
// (server API at /api/*) and as a fully static build (bundled ./data/*.json on
// GitHub Pages / any static host).
async function getJson(urls) {
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (r.ok) return await r.json();
    } catch { /* try next */ }
  }
  return null;
}

async function loadRunList() {
  const runs = (await getJson(src("/api/runs", "./data/runs.json"))) || [];
  els.runSelect.innerHTML = "";
  for (const r of runs) {
    const o = document.createElement("option");
    o.value = r.id; o.textContent = r.id;
    els.runSelect.appendChild(o);
  }
  return runs;
}

async function loadRun(id, mode = "all") {
  const data = await getJson(
    src(`/api/run?id=${encodeURIComponent(id)}`, `./data/run-${encodeURIComponent(id)}.json`)
  );
  if (!data || data.error) return;
  runIdCur = data.id; simulated = /^dry/.test(data.id);
  els.simBanner.classList.toggle("hidden", !simulated);
  els.runId.textContent = data.id;
  els.runSelect.value = data.id;
  if (mode === "replay") replay(data.events);
  else showAll(data.events);
}

async function pollLive() {
  try {
    const latest = await getJson(src("/api/run/latest", "./data/latest.json"));
    if (!latest || latest.error) return;
    if (latest.id !== runIdCur) { // a newer run started
      runIdCur = latest.id; simulated = /^dry/.test(latest.id);
      els.simBanner.classList.toggle("hidden", !simulated);
      els.runId.textContent = latest.id; els.runSelect.value = latest.id;
      showAll(latest.events);
      return;
    }
    // same run — apply any new tail events
    const tail = latest.events.filter((e) => e.seq > appliedSeq);
    for (const e of tail) applyEvent(e, true);
    if (tail.length) appliedSeq = latest.events[latest.events.length - 1].seq;
  } catch { /* server momentarily unavailable */ }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function safeParse(s) { try { return typeof s === "string" ? JSON.parse(s) : s; } catch { return null; } }

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------
els.runSelect.addEventListener("change", () => loadRun(els.runSelect.value, "all"));
els.replayBtn.addEventListener("click", () => runIdCur && loadRun(runIdCur, "replay"));
els.allBtn.addEventListener("click", () => runIdCur && loadRun(runIdCur, "all"));
els.liveToggle.addEventListener("change", () => {
  if (els.liveToggle.checked) { pollLive(); liveTimer = setInterval(pollLive, 1500); }
  else { clearInterval(liveTimer); liveTimer = null; }
});

(async function init() {
  const runs = await loadRunList();
  if (runs.length) await loadRun(runs[0].id, "all");
  else els.metadata.textContent = "No runs yet — run the agent (npm run dry).";
})();
