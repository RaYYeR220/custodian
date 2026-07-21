// dry-backend.ts — an offline, in-memory implementation of the tool Backend.
// It mirrors the custodian-mcp tool surface AND the on-chain behaviour (the
// Custodian contract's state machine + the Go feed server's scripted journey),
// WITHOUT Docker, testnet, the facilitator, or x402. This lets the full agent
// loop (real LLM reasoning over OpenRouter, simulated chain) run and be tested
// offline, and is the spec's "dry-run mode that logs intended actions".
//
// Numbers mirror custodian-contracts/bin/cli.rs (tokenize-demo) and
// x402/feeds/server/journey.go exactly so dry == live in everything but I/O.

import { createHash } from "node:crypto";
import type { Backend, ToolDef } from "./types.js";

// --- scripted journey (mirror of x402/feeds/server/journey.go) ---
interface TeleRow {
  temp_c: number;
  humidity: number;
  lat: number;
  lon: number;
  note: string;
}
const TELEMETRY: TeleRow[] = [
  { temp_c: 18.2, humidity: 60, lat: -23.96, lon: -46.3, note: "departed Santos" },
  { temp_c: 18.0, humidity: 61, lat: -15.5, lon: -30.1, note: "mid-Atlantic, nominal" },
  { temp_c: 17.8, humidity: 62, lat: 5.2, lon: -22.4, note: "crossing equator, nominal" },
  { temp_c: 31.4, humidity: 78, lat: 20.1, lon: -18.7, note: "COLD-CHAIN BREACH" },
  { temp_c: 18.5, humidity: 65, lat: 35.3, lon: -12.1, note: "temp recovered, degraded" },
  { temp_c: 18.1, humidity: 63, lat: 48.2, lon: -5.4, note: "approaching port" },
  { temp_c: 17.9, humidity: 61, lat: 51.95, lon: 4.13, note: "arrived Rotterdam" },
  { temp_c: 17.9, humidity: 60, lat: 51.9496, lon: 4.1453, note: "delivered at terminal" },
];
interface CustomsRow {
  at_customs: boolean;
  cleared: boolean;
  location: string;
}
const CUSTOMS: CustomsRow[] = [
  { at_customs: false, cleared: false, location: "at sea" },
  { at_customs: false, cleared: false, location: "at sea" },
  { at_customs: false, cleared: false, location: "at sea" },
  { at_customs: false, cleared: false, location: "at sea" },
  { at_customs: false, cleared: false, location: "at sea" },
  { at_customs: true, cleared: false, location: "Rotterdam customs" },
  { at_customs: true, cleared: true, location: "Rotterdam customs" },
  { at_customs: false, cleared: true, location: "Rotterdam terminal" },
];
const PRICE: number[] = [
  5_000_000, 5_000_000, 5_010_000, 5_000_000, 4_990_000, 5_000_000, 5_005_000, 5_000_000,
];
const BASE_TIME = Date.UTC(2026, 5, 10, 8, 0, 0); // 2026-06-10T08:00:00Z
function tickTime(tick: number): string {
  return new Date(BASE_TIME + tick * 6 * 3600 * 1000).toISOString();
}
function clampTick(tick: number, n: number): number {
  if (tick < 0) return 0;
  if (tick >= n) return n - 1;
  return tick;
}

// --- simulated chain state (mirror of tokenize-demo + the contract) ---
interface SimShipment {
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
}

function demoShipment(id: number): SimShipment {
  // qty 1000 * unit_price 5_000_000 * score/100 = 5 CSPR at score 100.
  return {
    id: String(id),
    metadata: "DEMO Coffee Santos->Rotterdam",
    status: "InTransit",
    quantity: "1000",
    unit_price: "5000000",
    condition_score: "100",
    initial_value: "5000000000",
    appraised_value: "5000000000",
    escrow: "5000000000",
    insurance_coverage: "4000000000",
    at_customs: "false",
    delayed: "false",
    delay_penalty: "0",
    data_spend: "0",
    last_update: "0",
    holders: "[deployer]",
    shares: "[100]",
  };
}

function recompute(s: SimShipment): void {
  const qty = BigInt(s.quantity);
  const price = BigInt(s.unit_price);
  const score = BigInt(s.condition_score);
  s.appraised_value = ((qty * price * score) / 100n).toString();
}

// JSON Schemas mirror mcp/src/server.ts (kept faithful so the model sees the
// same tool contract dry or live).
const num = { type: "integer", minimum: 0 };
const moteStr = { type: "string", pattern: "^\\d+$" };
const TOOLS: ToolDef[] = [
  fn("get_shipment", "Read the full Custodian shipment record (motes).", { id: num }, ["id"]),
  fn("get_status", "Read the lifecycle status of a shipment.", { id: num }, ["id"]),
  fn("get_value", "Read the current appraised value (motes).", { id: num }, ["id"]),
  fn("get_data_spend", "Read cumulative x402 data spend recorded on-chain.", { id: num }, ["id"]),
  fn(
    "revalue",
    "Re-appraise an InTransit shipment (cold-chain breach or price move). reason_code 1=breach 2=price.",
    {
      id: num,
      new_unit_price: moteStr,
      new_condition_score: { type: "integer", minimum: 0, maximum: 100 },
      reason_code: { type: "integer", minimum: 0, maximum: 255 },
    },
    ["id", "new_unit_price", "new_condition_score", "reason_code"]
  ),
  fn("flag_delay", "Mark an InTransit shipment delayed; add a penalty (motes).", { id: num, penalty: moteStr }, [
    "id",
    "penalty",
  ]),
  fn(
    "set_customs",
    "Set the at_customs flag + location for an InTransit shipment.",
    { id: num, at_customs: { type: "boolean" }, location: { type: "string" } },
    ["id", "at_customs", "location"]
  ),
  fn("confirm_delivery", "Mark an InTransit shipment Delivered (required before distribute).", { id: num }, ["id"]),
  fn("distribute", "Pay appraised value (capped at escrow) pro-rata; Delivered -> Settled.", { id: num }, ["id"]),
  fn("report_loss", "Declare an InTransit shipment Lost (telemetry/GPS silent).", { id: num }, ["id"]),
  fn("trigger_insurance", "Pay insurance coverage (capped at escrow) pro-rata; Lost -> Settled.", { id: num }, ["id"]),
  fn("record_data_spend", "Record an x402 data-feed payment on-chain (motes).", { id: num, amount: moteStr }, [
    "id",
    "amount",
  ]),
  fn(
    "pay_for_telemetry",
    "Pay x402 + fetch telemetry {temp_c,humidity,lat,lon,lost,note,ts}. shipment='loss' for the silent variant.",
    { shipment: { type: "string" }, tick: num },
    ["shipment", "tick"]
  ),
  fn("pay_for_price", "Pay x402 + fetch market price {unit_price,currency,ts}.", { commodity: { type: "string" }, tick: num }, [
    "commodity",
    "tick",
  ]),
  fn("pay_for_customs", "Pay x402 + fetch customs {at_customs,cleared,location,ts}.", { shipment: { type: "string" }, tick: num }, [
    "shipment",
    "tick",
  ]),
];

function fn(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[]
): ToolDef {
  return {
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required } },
  };
}

export interface DryOpts {
  /** Multiplier applied to the price feed — >1 simulates a material market move. */
  priceSpike?: number;
  /** Apply the spike only from this tick on (so the feed shows a JUMP, not a flat level). */
  priceSpikeFromTick?: number;
}

/** In-memory backend: same tools + behaviour as the live MCP, no I/O. */
export class DryBackend implements Backend {
  private ships = new Map<number, SimShipment>();
  private seq = 0;
  private priceSpike: number;
  private priceSpikeFromTick: number;

  constructor(ids: number[] = [0], opts: DryOpts = {}) {
    for (const id of ids) this.ships.set(id, demoShipment(id));
    this.priceSpike = opts.priceSpike ?? 1;
    this.priceSpikeFromTick = opts.priceSpikeFromTick ?? 0;
  }

  async tools(): Promise<ToolDef[]> {
    return TOOLS;
  }

  async close(): Promise<void> {
    /* nothing to tear down */
  }

  private fakeTx(seed: string): string {
    return createHash("sha256").update(`dry:${seed}:${this.seq++}`).digest("hex");
  }

  private get(id: number): SimShipment {
    const s = this.ships.get(id);
    if (!s) throw new Error(`unknown shipment ${id}`);
    return s;
  }

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      return JSON.stringify(this.dispatch(name, args), null, 2);
    } catch (e) {
      return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private dispatch(name: string, a: Record<string, unknown>): unknown {
    const id = typeof a.id === "number" ? a.id : Number(a.id);
    const tick = typeof a.tick === "number" ? a.tick : Number(a.tick);
    switch (name) {
      // --- reads ---
      case "get_shipment":
        return this.get(id);
      case "get_status":
        return { status: this.get(id).status };
      case "get_value":
        return { appraised_value: this.get(id).appraised_value };
      case "get_data_spend":
        return { data_spend: this.get(id).data_spend };

      // --- feeds (x402 simulated) ---
      case "pay_for_telemetry": {
        const shipment = String(a.shipment ?? "0");
        const tx = this.fakeTx(`telemetry:${shipment}:${tick}`);
        // Loss variant: nominal early, then telemetry+GPS go silent from tick 3
        // (cargo lost mid-voyage) — a realistic "was fine, then went dark" arc.
        if (shipment === "loss" && tick >= 3) {
          return {
            status: 200,
            tx,
            data: { shipment, tick, lost: true, temp_c: 0, humidity: 0, lat: 0, lon: 0, ts: tickTime(tick) },
          };
        }
        const row = TELEMETRY[clampTick(tick, TELEMETRY.length)];
        return { status: 200, tx, data: { shipment, tick, lost: false, ...row, ts: tickTime(tick) } };
      }
      case "pay_for_price": {
        const commodity = String(a.commodity ?? "coffee");
        const mult = tick >= this.priceSpikeFromTick ? this.priceSpike : 1;
        const price = Math.round(PRICE[clampTick(tick, PRICE.length)] * mult);
        return {
          status: 200,
          tx: this.fakeTx(`price:${commodity}:${tick}`),
          data: { commodity, tick, unit_price: price, currency: "USD", ts: tickTime(tick) },
        };
      }
      case "pay_for_customs": {
        const shipment = String(a.shipment ?? "0");
        const row = CUSTOMS[clampTick(tick, CUSTOMS.length)];
        return { status: 200, tx: this.fakeTx(`customs:${shipment}:${tick}`), data: { shipment, tick, ...row, ts: tickTime(tick) } };
      }

      // --- actions (mutate sim state, same guards as the contract) ---
      case "revalue": {
        const s = this.requireStatus(id, "InTransit");
        s.unit_price = String(a.new_unit_price);
        s.condition_score = String(a.new_condition_score);
        recompute(s);
        return { action: "revalue", id, txHash: this.fakeTx(`revalue:${id}`), retried: false };
      }
      case "flag_delay": {
        const s = this.requireStatus(id, "InTransit");
        s.delayed = "true";
        s.delay_penalty = (BigInt(s.delay_penalty) + BigInt(String(a.penalty))).toString();
        return { action: "flag_delay", id, txHash: this.fakeTx(`flag_delay:${id}`), retried: false };
      }
      case "set_customs": {
        const s = this.requireStatus(id, "InTransit");
        s.at_customs = a.at_customs ? "true" : "false";
        return { action: "set_customs", id, txHash: this.fakeTx(`set_customs:${id}`), retried: false };
      }
      case "confirm_delivery": {
        const s = this.requireStatus(id, "InTransit");
        s.status = "Delivered";
        return { action: "confirm_delivery", id, txHash: this.fakeTx(`confirm_delivery:${id}`), retried: false };
      }
      case "distribute": {
        const s = this.requireStatus(id, "Delivered");
        const appraised = BigInt(s.appraised_value);
        const escrow = BigInt(s.escrow);
        const payout = appraised > escrow ? escrow : appraised;
        s.escrow = (escrow - payout).toString();
        s.status = "Settled";
        return { action: "distribute", id, payout: payout.toString(), txHash: this.fakeTx(`distribute:${id}`), retried: false };
      }
      case "report_loss": {
        const s = this.requireStatus(id, "InTransit");
        s.status = "Lost";
        return { action: "report_loss", id, txHash: this.fakeTx(`report_loss:${id}`), retried: false };
      }
      case "trigger_insurance": {
        const s = this.requireStatus(id, "Lost");
        const cover = BigInt(s.insurance_coverage);
        const escrow = BigInt(s.escrow);
        const payout = cover > escrow ? escrow : cover;
        s.escrow = (escrow - payout).toString();
        s.status = "Settled";
        return { action: "trigger_insurance", id, payout: payout.toString(), txHash: this.fakeTx(`trigger_insurance:${id}`), retried: false };
      }
      case "record_data_spend": {
        const s = this.get(id);
        s.data_spend = (BigInt(s.data_spend) + BigInt(String(a.amount))).toString();
        return { action: "record_data_spend", id, txHash: this.fakeTx(`record_data_spend:${id}`), retried: false };
      }
      default:
        throw new Error(`unknown tool ${name}`);
    }
  }

  /** Mirror the contract's status guard (revert -> ERROR string). */
  private requireStatus(id: number, want: string): SimShipment {
    const s = this.get(id);
    if (s.status !== want) throw new Error(`InvalidStatus: ${want} required, is ${s.status}`);
    return s;
  }
}
