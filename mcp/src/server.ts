#!/usr/bin/env node
// server.ts — the Custodian MCP server (Agent Skills layer of the Casper AI
// Toolkit). Exposes the PROVEN Custodian contract operations + x402 data-feed
// payments as MCP tools over stdio. It is a thin orchestrator: every tool shells
// an already-working command (odra-cli in Docker for the chain, the Go x402
// client in Docker for feeds) and returns structured content.
//
// Tool families:
//   reads    : get_shipment, get_status, get_value, get_data_spend
//   actions  : revalue, flag_delay, set_customs, confirm_delivery, distribute,
//              report_loss, trigger_insurance, record_data_spend  (return tx hash)
//   feeds    : pay_for_telemetry, pay_for_price, pay_for_customs   (x402 micropay)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { odraRead, odraWrite, GAS } from "./odra.js";
import { payForTelemetry, payForPrice, payForCustoms } from "./feeds.js";

const server = new McpServer({
  name: "custodian-mcp",
  version: "0.1.0",
});

// Helpers to wrap a result as MCP content (text + structuredContent).
function ok(structured: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured as Record<string, unknown>,
  };
}
function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `ERROR: ${message}` }],
    isError: true as const,
  };
}

const idArg = { id: z.number().int().nonnegative().describe("Shipment id (u64).") };

// ---------------------------------------------------------------------------
// Reads (free, fast — query live testnet state)
// ---------------------------------------------------------------------------

server.registerTool(
  "get_shipment",
  {
    title: "Get shipment",
    description:
      "Read the full Custodian shipment record from Casper testnet: status, " +
      "quantity, unit_price, condition_score, initial/appraised value, escrow, " +
      "insurance_coverage, at_customs, delayed, delay_penalty, data_spend, " +
      "holders, shares. All monetary fields are CSPR motes (1 CSPR = 1e9). Free.",
    inputSchema: idArg,
  },
  async ({ id }) => {
    try {
      return ok(await odraRead("get_shipment", id));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "get_status",
  {
    title: "Get shipment status",
    description:
      "Read just the lifecycle status of a shipment: Created | InTransit | " +
      "Delivered | Lost | Settled. Free.",
    inputSchema: idArg,
  },
  async ({ id }) => {
    try {
      return ok({ status: await odraRead("get_status", id) });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "get_value",
  {
    title: "Get appraised value",
    description:
      "Read the current appraised value of a shipment in CSPR motes " +
      "(quantity * unit_price * condition_score / 100). Free.",
    inputSchema: idArg,
  },
  async ({ id }) => {
    try {
      return ok({ appraised_value: await odraRead("get_value", id) });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "get_data_spend",
  {
    title: "Get cumulative data spend",
    description:
      "Read the cumulative x402 data-feed spend recorded on-chain for a " +
      "shipment, in the X402 token's smallest unit. Free.",
    inputSchema: idArg,
  },
  async ({ id }) => {
    try {
      return ok({ data_spend: await odraRead("get_data_spend", id) });
    } catch (e) {
      return fail(e);
    }
  }
);

// ---------------------------------------------------------------------------
// Actions (operator-gated, mutating — return the tx hash)
// ---------------------------------------------------------------------------

server.registerTool(
  "revalue",
  {
    title: "Revalue shipment",
    description:
      "Re-appraise a shipment in transit (e.g. cold-chain breach or market " +
      "price move). Sets a new unit_price and condition_score (0..100); the " +
      "appraised value is recomputed. reason_code is a free integer tag (e.g. " +
      "1=breach, 2=price-move). Shipment must be InTransit. Returns the tx hash.",
    inputSchema: {
      id: idArg.id,
      new_unit_price: z
        .string()
        .regex(/^\d+$/)
        .describe("New unit price in CSPR motes (U512, decimal string)."),
      new_condition_score: z
        .number()
        .int()
        .min(0)
        .max(100)
        .describe("New condition score 0..100 (u8). 100 = perfect."),
      reason_code: z
        .number()
        .int()
        .min(0)
        .max(255)
        .describe("Reason tag (u8), e.g. 1=cold-chain breach, 2=price move."),
    },
  },
  async ({ id, new_unit_price, new_condition_score, reason_code }) => {
    try {
      const r = await odraWrite(
        "revalue",
        [
          "--id", String(id),
          "--new_unit_price", new_unit_price,
          "--new_condition_score", String(new_condition_score),
          "--reason_code", String(reason_code),
        ],
        GAS.simple
      );
      return ok({ action: "revalue", id, txHash: r.txHash, retried: r.retried });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "flag_delay",
  {
    title: "Flag delay",
    description:
      "Mark a shipment as delayed and add a penalty (cumulative). Shipment must " +
      "be InTransit. Returns the tx hash.",
    inputSchema: {
      id: idArg.id,
      penalty: z
        .string()
        .regex(/^\d+$/)
        .describe("Penalty to add in CSPR motes (U512, decimal string)."),
    },
  },
  async ({ id, penalty }) => {
    try {
      const r = await odraWrite(
        "flag_delay",
        ["--id", String(id), "--penalty", penalty],
        GAS.simple
      );
      return ok({ action: "flag_delay", id, txHash: r.txHash, retried: r.retried });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "set_customs",
  {
    title: "Set customs state",
    description:
      "Set the at_customs flag and a location string for a shipment (e.g. when " +
      "it reaches / clears customs). Shipment must be InTransit. Returns the tx hash.",
    inputSchema: {
      id: idArg.id,
      at_customs: z.boolean().describe("True if currently held at customs."),
      location: z.string().describe("Customs/location label, e.g. 'Rotterdam customs'."),
    },
  },
  async ({ id, at_customs, location }) => {
    try {
      const r = await odraWrite(
        "set_customs",
        ["--id", String(id), "--at_customs", String(at_customs), "--location", location],
        GAS.simple
      );
      return ok({ action: "set_customs", id, txHash: r.txHash, retried: r.retried });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "confirm_delivery",
  {
    title: "Confirm delivery",
    description:
      "Mark a shipment as Delivered (must be InTransit). Required before " +
      "distribute. Returns the tx hash.",
    inputSchema: idArg,
  },
  async ({ id }) => {
    try {
      const r = await odraWrite("confirm_delivery", ["--id", String(id)], GAS.simple);
      return ok({ action: "confirm_delivery", id, txHash: r.txHash, retried: r.retried });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "distribute",
  {
    title: "Distribute proceeds",
    description:
      "Pay out the appraised value (capped at escrow) pro-rata to holders in " +
      "native CSPR and mark the shipment Settled. Must be Delivered first. " +
      "Returns the tx hash.",
    inputSchema: idArg,
  },
  async ({ id }) => {
    try {
      const r = await odraWrite("distribute", ["--id", String(id)], GAS.heavy);
      return ok({ action: "distribute", id, txHash: r.txHash, retried: r.retried });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "report_loss",
  {
    title: "Report loss",
    description:
      "Declare a shipment Lost (e.g. telemetry/GPS went silent). Must be " +
      "InTransit. Precondition for trigger_insurance. Returns the tx hash.",
    inputSchema: idArg,
  },
  async ({ id }) => {
    try {
      const r = await odraWrite("report_loss", ["--id", String(id)], GAS.simple);
      return ok({ action: "report_loss", id, txHash: r.txHash, retried: r.retried });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "trigger_insurance",
  {
    title: "Trigger insurance",
    description:
      "Pay out the insurance coverage (capped at escrow) pro-rata to holders in " +
      "native CSPR and mark the shipment Settled. Must be Lost first. Returns the tx hash.",
    inputSchema: idArg,
  },
  async ({ id }) => {
    try {
      const r = await odraWrite("trigger_insurance", ["--id", String(id)], GAS.heavy);
      return ok({ action: "trigger_insurance", id, txHash: r.txHash, retried: r.retried });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "record_data_spend",
  {
    title: "Record data spend",
    description:
      "Record (accumulate) the cost of an x402 data-feed payment on-chain for a " +
      "shipment, so the asset's data-acquisition cost is auditable. Call after " +
      "paying for a feed. amount is in the X402 token's smallest unit. Returns the tx hash.",
    inputSchema: {
      id: idArg.id,
      amount: z
        .string()
        .regex(/^\d+$/)
        .describe("Amount to add (U512, decimal string), e.g. 100000000 = 0.1 X402."),
    },
  },
  async ({ id, amount }) => {
    try {
      const r = await odraWrite(
        "record_data_spend",
        ["--id", String(id), "--amount", amount],
        GAS.simple
      );
      return ok({ action: "record_data_spend", id, txHash: r.txHash, retried: r.retried });
    } catch (e) {
      return fail(e);
    }
  }
);

// ---------------------------------------------------------------------------
// x402 data feeds (pay micropayment on testnet, return data + settlement tx)
// Runtime-depends on facilitator (:4022) + feed server (:4023) being up.
// ---------------------------------------------------------------------------

server.registerTool(
  "pay_for_telemetry",
  {
    title: "Pay for telemetry feed",
    description:
      "Pay an x402 micropayment (settled on Casper testnet) and fetch the " +
      "telemetry data point for a shipment at a journey tick: " +
      "{ temp_c, humidity, lat, lon, lost, note, ts }. Use shipment='loss' to " +
      "exercise the silent/lost variant. Returns the data + settlement tx hash. " +
      "REQUIRES the x402 facilitator (:4022) + feed server (:4023) running.",
    inputSchema: {
      shipment: z.string().describe("Shipment id, or 'loss' for the silent variant."),
      tick: z.number().int().min(0).describe("Journey tick (0..7; clamps past 7)."),
    },
  },
  async ({ shipment, tick }) => {
    try {
      return ok(await payForTelemetry(shipment, tick));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "pay_for_price",
  {
    title: "Pay for price feed",
    description:
      "Pay an x402 micropayment (settled on Casper testnet) and fetch the " +
      "market price for a commodity at a tick: { unit_price, currency, ts }. " +
      "Returns the data + settlement tx hash. REQUIRES the x402 facilitator " +
      "(:4022) + feed server (:4023) running.",
    inputSchema: {
      commodity: z.string().describe("Commodity symbol, e.g. 'coffee'."),
      tick: z.number().int().min(0).describe("Journey tick (0..7; clamps past 7)."),
    },
  },
  async ({ commodity, tick }) => {
    try {
      return ok(await payForPrice(commodity, tick));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "pay_for_customs",
  {
    title: "Pay for customs feed",
    description:
      "Pay an x402 micropayment (settled on Casper testnet) and fetch the " +
      "customs status for a shipment at a tick: { at_customs, cleared, location, " +
      "ts }. Returns the data + settlement tx hash. REQUIRES the x402 " +
      "facilitator (:4022) + feed server (:4023) running.",
    inputSchema: {
      shipment: z.string().describe("Shipment id."),
      tick: z.number().int().min(0).describe("Journey tick (0..7; clamps past 7)."),
    },
  },
  async ({ shipment, tick }) => {
    try {
      return ok(await payForCustoms(shipment, tick));
    } catch (e) {
      return fail(e);
    }
  }
);

// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the MCP stdio channel.
  console.error("custodian-mcp server running on stdio");
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
