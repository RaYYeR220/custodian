// test-client.ts — short MCP client smoke test. Spawns the built server over
// stdio, lists tools, then calls get_shipment(id=0) which must return the live
// testnet shipment 0 (seeded by Plan 1's tokenize-demo). Proves the whole
// MCP -> odra-cli -> Casper testnet path works through the server.
//
// Run after `npm run build`:  node dist/test-client.js
// Optional: also exercise a write with  node dist/test-client.js --write

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(__dirname, "server.js");

async function main() {
  const doWrite = process.argv.includes("--write");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
  });
  const client = new Client({ name: "custodian-test-client", version: "0.1.0" });
  await client.connect(transport); // performs initialize

  const tools = await client.listTools();
  console.log("=== tools/list ===");
  console.log(tools.tools.map((t) => t.name).join(", "));

  console.log("\n=== get_shipment id=0 ===");
  const res = await client.callTool({
    name: "get_shipment",
    arguments: { id: 0 },
  });
  const text = (res.content as Array<{ type: string; text?: string }>)
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  console.log(text);
  if (res.isError) {
    await client.close();
    process.exit(1);
  }

  if (doWrite) {
    console.log("\n=== record_data_spend id=0 amount=100000000 ===");
    const w = await client.callTool({
      name: "record_data_spend",
      arguments: { id: 0, amount: "100000000" },
    });
    const wtext = (w.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    console.log(wtext);
  }

  await client.close();
}

main().catch((err) => {
  console.error("test-client failed:", err);
  process.exit(1);
});
