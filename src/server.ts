/**
 * MCP server setup and tool registration.
 * Handles mode detection (live / local / hybrid) and routes tool calls appropriately.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "fs";
import Sqlite from "better-sqlite3";

import { LIVE_TOOL_DEFS, handleLiveTool } from "./tools/live.js";
import { LOCAL_TOOL_DEFS, handleLocalTool } from "./tools/local.js";
import { openDatabase } from "./db/indexer.js";

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

export interface ServerMode {
  hasLive: boolean;
  hasLocal: boolean;
  token: string | null;
  dbPath: string | null;
}

export function detectMode(): ServerMode {
  const token = process.env.LEGISTAR_TOKEN ?? null;
  const dbPath = process.env.LEGISTAR_DB_PATH ?? null;

  const hasLive = !!token;
  const hasLocal = !!dbPath && existsSync(dbPath);

  return { hasLive, hasLocal, token, dbPath };
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

export async function startServer(): Promise<void> {
  const mode = detectMode();

  if (!mode.hasLive && !mode.hasLocal) {
    console.error(`
Error: No data source configured.

Set at least one of:
  LEGISTAR_TOKEN    — enables live Legistar API tools (get_bill, upcoming hearings, etc.)
  LEGISTAR_DB_PATH  — enables local SQLite fast-path tools (search_bills, voting history, etc.)

Recommended: set both for hybrid mode.

  LEGISTAR_TOKEN   — register at https://council.nyc.gov/legislation/api/
  LEGISTAR_DB_PATH — build with: npx @betanyc/nyc-council-mcp index --help

See README for full setup instructions.
`);
    process.exit(1);
  }

  // Log active mode to stderr (not stdout — that's reserved for MCP JSON)
  if (mode.hasLive && mode.hasLocal) {
    console.error("nyc-council-mcp: hybrid mode (live API + local SQLite index)");
  } else if (mode.hasLocal) {
    console.error("nyc-council-mcp: local-only mode (SQLite index). Set LEGISTAR_TOKEN for live API tools.");
  } else {
    console.error("nyc-council-mcp: live-only mode (Legistar API). Set LEGISTAR_DB_PATH for fast local search.");
  }

  // Open SQLite connection (kept open for server lifetime)
  let db: ReturnType<typeof Sqlite> | null = null;
  if (mode.hasLocal && mode.dbPath) {
    db = openDatabase(mode.dbPath);
  }

  // Build tool list
  const toolDefs = [
    ...(mode.hasLocal ? LOCAL_TOOL_DEFS : []),
    ...(mode.hasLive ? LIVE_TOOL_DEFS : []),
  ];

  // Build set of local and live tool names for routing
  const localNames = new Set(LOCAL_TOOL_DEFS.map((t) => t.name));
  const liveNames = new Set(LIVE_TOOL_DEFS.map((t) => t.name));

  const server = new Server(
    { name: "nyc-council-mcp", version: "2.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefs }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const safeArgs = (args ?? {}) as Record<string, unknown>;

    // Route to local (SQLite) handler
    if (mode.hasLocal && db && localNames.has(name)) {
      return handleLocalTool(name, safeArgs, db);
    }

    // Route to live API handler
    if (mode.hasLive && mode.token && liveNames.has(name)) {
      return handleLiveTool(name, safeArgs, mode.token);
    }

    // Tool known but its data source is not available
    if (localNames.has(name) && !mode.hasLocal) {
      return {
        content: [{
          type: "text",
          text: `Tool '${name}' requires the local SQLite index. Set LEGISTAR_DB_PATH and run:\n  npx @betanyc/nyc-council-mcp index --archive <path> --db <path>`,
        }],
        isError: true,
      };
    }
    if (liveNames.has(name) && !mode.hasLive) {
      return {
        content: [{
          type: "text",
          text: `Tool '${name}' requires the live Legistar API. Set LEGISTAR_TOKEN (register at https://council.nyc.gov/legislation/api/).`,
        }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
