// Graded decision scenarios for the Custodian agent. Each is a single situation
// with a HIDDEN answer key: the on-chain action(s) a correct operator must take
// (`expected`) and the ones it must NOT take (`forbidden`). The eval runs the
// REAL agent (LLM reasoning) against each and scores its choice — proving the
// agent reasons correctly, not that it "ran once".

export interface Scenario {
  id: string;
  title: string;
  situation: string;
  feedShipment: string; // telemetry/customs key ("0" or "loss")
  tick: number; // the decision tick — the action is graded HERE
  tickStart?: number; // run from here to `tick` for context (default: `tick`)
  priceSpike?: number; // >1 = a material market move on the price feed
  priceSpikeFromTick?: number; // apply the spike from this tick (so the feed shows a jump)
  tickHint?: string;
  expected: string[]; // action(s) that MUST be taken at the decision tick
  forbidden: string[]; // action(s) that must NOT be taken at the decision tick
}

export const SCENARIOS: Scenario[] = [
  {
    id: "nominal",
    title: "Nominal transit",
    situation: "Telemetry ~18 °C mid-voyage, no customs event — nothing is wrong.",
    feedShipment: "0",
    tick: 0,
    expected: [],
    forbidden: ["revalue", "flag_delay", "set_customs", "confirm_delivery", "distribute", "report_loss", "trigger_insurance"],
  },
  {
    id: "breach",
    title: "Cold-chain breach",
    situation: "Telemetry spikes to 31.4 °C — the reefer failed, cargo degraded.",
    feedShipment: "0",
    tick: 3,
    expected: ["revalue"],
    forbidden: ["confirm_delivery", "distribute", "report_loss", "trigger_insurance"],
  },
  {
    id: "price-move",
    title: "Market price move",
    situation: "Coffee's market price jumps ~50% — the asset should be marked to market.",
    feedShipment: "0",
    tick: 1,
    tickStart: 0,
    priceSpike: 1.5,
    priceSpikeFromTick: 1,
    tickHint: "Also fetch the current market price for coffee this tick.",
    expected: ["revalue"],
    forbidden: ["report_loss", "trigger_insurance", "confirm_delivery", "distribute"],
  },
  {
    id: "customs",
    title: "Held at customs",
    situation: "Cargo reaches Rotterdam customs, not yet cleared.",
    feedShipment: "0",
    tick: 5,
    expected: ["set_customs"],
    forbidden: ["confirm_delivery", "distribute", "report_loss", "trigger_insurance"],
  },
  {
    id: "delivery",
    title: "Cleared + delivered",
    situation: "Customs cleared and the cargo has arrived at the destination.",
    feedShipment: "0",
    tick: 6,
    expected: ["confirm_delivery"],
    forbidden: ["report_loss", "trigger_insurance", "revalue"],
  },
  {
    id: "loss",
    title: "Telemetry lost",
    situation: "Telemetry was nominal, then GPS + telemetry go silent — cargo presumed lost.",
    feedShipment: "loss",
    tick: 3,
    tickStart: 0,
    expected: ["report_loss"],
    forbidden: ["distribute", "confirm_delivery", "revalue"],
  },
];
