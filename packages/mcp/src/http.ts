#!/usr/bin/env node
/**
 * Bloom Exchange MCP server over Streamable HTTP, stateless: every POST /mcp gets a fresh server and transport,
 * so it scales horizontally behind any load balancer with no session affinity.
 *
 *   BLOOM_EXCHANGE_URL=https://node.example PORT=8787 npx -y -p @bloom-exchange/mcp bloom-exchange-mcp-http
 *
 * Binds to 127.0.0.1 by default (MCP_HOST to change). Put authentication in front before exposing it.
 */
import { createServer, type IncomingMessage } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { configFromEnv } from "./config.ts";
import { createBloomMcpServer } from "./server.ts";

const config = configFromEnv();
const port = Number(process.env.PORT ?? 8787);
const host = process.env.MCP_HOST ?? "127.0.0.1";

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

const http = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, node: config.baseUrl }));
    return;
  }
  if (path !== "/mcp") {
    res.writeHead(404).end();
    return;
  }
  if (req.method !== "POST") {
    // Stateless mode: no server-initiated streams to resume, no sessions to delete.
    res.writeHead(405, { Allow: "POST" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
    return;
  }
  try {
    const server = createBloomMcpServer(config);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, await body(req));
  } catch (err) {
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: err instanceof Error ? err.message : "Internal error" }, id: null }));
  }
});

http.listen(port, host, () => console.error(`bloom-exchange MCP (Streamable HTTP) on http://${host}:${port}/mcp → ${config.baseUrl}`));
