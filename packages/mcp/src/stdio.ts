#!/usr/bin/env node
/**
 * Bloom Exchange MCP server over stdio, for Claude Code, Cursor and other local MCP clients:
 *
 *   claude mcp add bloom-exchange -e BLOOM_EXCHANGE_URL=http://localhost:3000 -- npx -y @bloom-exchange/mcp
 *
 * Environment: BLOOM_EXCHANGE_URL (default http://localhost:3000), BLOOM_ACCESS_KEY, BLOOM_AGENT_NAME.
 * stdout carries the protocol only; diagnostics go to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { configFromEnv } from "./config.ts";
import { createBloomMcpServer } from "./server.ts";

const config = configFromEnv();
const server = createBloomMcpServer(config);
await server.connect(new StdioServerTransport());
console.error(`bloom-exchange MCP (stdio) → ${config.baseUrl}`);
