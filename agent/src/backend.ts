// backend.ts — the LIVE tool backend. The agent is an MCP *client*: it spawns
// the proven custodian-mcp server (mcp/dist/server.js) over stdio, lists its
// tools, and calls them. Those tool calls reach Casper testnet (odra-cli in
// Docker) and the x402 feeds (Go client in Docker) exactly as validated in
// Plans 1-3. The agent reimplements no on-chain plumbing.
//
// Prerequisites for a live run: mcp must be built (`cd mcp && npm run build`),
// the x402 facilitator (:4022) + feed server (:4023) up for the feed tools, and
// a fresh InTransit shipment tokenized (shipment 0 is Settled).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
import { REPO_ROOT } from "./config.js";
import { mcpToolsToOpenAI, type McpTool } from "./convert.js";
import type { Backend, ToolDef } from "./types.js";

const SERVER = resolve(REPO_ROOT, "mcp", "dist", "server.js");

/**
 * Env for the spawned MCP server. StdioClientTransport otherwise passes only a
 * minimal safe env, so we forward the parent env and default the x402 feed URLs
 * to host.docker.internal — the MCP's feed tools shell a SEPARATE golang
 * container, so from there the facilitator/feed server (published on the host)
 * are reachable at host.docker.internal, not localhost.
 */
function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  env.FEEDS_FACILITATOR_URL ??= "http://host.docker.internal:4022";
  env.FEEDS_SERVER_URL ??= "http://host.docker.internal:4023";
  return env;
}

export class McpBackend implements Backend {
  private client: Client;
  private connected = false;

  constructor(private serverPath: string = SERVER) {
    this.client = new Client({ name: "custodian-agent", version: "0.1.0" });
  }

  private async ensure(): Promise<void> {
    if (this.connected) return;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [this.serverPath],
      env: childEnv(),
    });
    await this.client.connect(transport); // performs initialize
    this.connected = true;
  }

  async tools(): Promise<ToolDef[]> {
    await this.ensure();
    const list = await this.client.listTools();
    return mcpToolsToOpenAI(list.tools as unknown as McpTool[]);
  }

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    await this.ensure();
    const res = await this.client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text?: string }> | undefined)
      ?.filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    const body = text && text.length > 0 ? text : JSON.stringify(res.structuredContent ?? {});
    return res.isError ? `ERROR: ${body}` : body;
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
    }
  }
}
