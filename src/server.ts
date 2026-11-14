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
import { existsSync, readFileSync } from "fs";
import Sqlite from "better-sqlite3";

import { withSourceNote, checkUpcomingLive } from "./tools/local-source.js";
import { withMemberTerms } from "./tools/member-terms.js";
import { withCurated } from "./curated.js";
import { BETANYC_INSTRUCTIONS, createBetanycTools } from "./betanyc-tools.js";
import { getEventStatuses } from "./legistar.js";
import { LIVE_TOOL_DEFS, LIVE_SEARCH_TOOL_DEF, handleLiveTool, handleLiveSearch } from "./tools/live.js";
import { LOCAL_TOOL_DEFS, handleLocalTool } from "./tools/local.js";
import { openDatabase } from "./db/indexer.js";

// Read the version from package.json so the MCP server never drifts from the
// published package version (it was previously hardcoded and had drifted).
const PACKAGE_VERSION = (
  JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf-8")
  ) as { version: string }
).version;

// ---------------------------------------------------------------------------
// BetaNYC's shared tools: whats_changed, about_betanyc and about_data (#75, #48, #77)
// ---------------------------------------------------------------------------
// All three come from src/betanyc-tools.ts, a copy of the BetaNYC workspace's
// scripts/mcp_shared/betanyc-tools.ts: never edit it here. How current each source is comes
// from real state, never typed into DATA-SOURCES.json: the index's build time and the district
// snapshot's fetch time (hooks below), and the curated files' own checked_at (freshness "file").

export const SERVER_NAME = "nyc-council-mcp";
export const REPO_URL = "https://github.com/BetaNYC/nyc-council-mcp";
const TERMS_PATH = new URL("../data/council-member-terms.json", import.meta.url);

/** Without a token the live tools are not listed, so about_data must not call the live source
 * "fetched from the source when you ask" (#67). */
export const LIVE_UNAVAILABLE_REASON = "the live Legistar API is not set up (no LEGISTAR_TOKEN)";

/** The server's MCP instructions: what it covers, then the shared module's own instructions
 * (call about_data, about_betanyc and whats_changed), then this server's rules. */
export const SERVER_INSTRUCTIONS =
  "NYC Council legislation, votes, hearings and members, by BetaNYC. " +
  BETANYC_INSTRUCTIONS +
  " Facts in a 'curated' block were checked by BetaNYC and are not official records: say so when you use them. " +
  "Nothing is invented: a value with no source is left blank.";

function indexState(db: Sqlite.Database | null, key: string): string | null {
  if (!db) return null;
  try {
    const row = db.prepare("SELECT value FROM index_state WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function snapshotFetchedAt(): string | null {
  try {
    const v = (JSON.parse(readFileSync(TERMS_PATH, "utf8")) as { fetched_at?: unknown }).fetched_at;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** The shared tools for one mode. Throws at startup if DATA-SOURCES.json does not describe this
 * server. `dataSourcesText` is for tests. */
export function betanycTools(ctx: { db: Sqlite.Database | null; hasLive: boolean; version: string; dataSourcesText?: string }) {
  return createBetanycTools({
    serverName: SERVER_NAME,
    version: ctx.version,
    repoUrl: REPO_URL,
    whatsChangedPath: new URL("../WHATS-CHANGED.md", import.meta.url),
    dataSourcesPath: new URL("../DATA-SOURCES.json", import.meta.url),
    ...(ctx.dataSourcesText !== undefined ? { dataSourcesText: ctx.dataSourcesText } : {}),
    freshness: {
      // When this server's local index was built (the indexer writes it).
      index_built: () => indexState(ctx.db, "last_indexed_at"),
      // When the district snapshot loaded into the index was fetched from NYC Open Data;
      // with no index, the snapshot that ships with the package.
      member_terms_fetched: () =>
        ctx.db ? indexState(ctx.db, "member_terms_fetched_at") : snapshotFetchedAt(),
    },
    ...(ctx.hasLive ? {} : { unavailableSources: { live: LIVE_UNAVAILABLE_REASON } }),
  });
}

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

  if (!mode.hasLive && !mode.hasLocal && mode.dbPath) {
    console.error(`
Error: LEGISTAR_DB_PATH is set, but the index was not found at:
  ${mode.dbPath}

Build it with: npx @betanyc/nyc-council-mcp index --help
Or set LEGISTAR_TOKEN to use the live Legistar API without an index.
`);
    process.exit(1);
  }

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

  // BetaNYC's shared tools (#75, #48): whats_changed, about_betanyc and about_data, from the
  // shared module. Throws here, at startup, if DATA-SOURCES.json does not describe this server.
  const shared = betanycTools({ db, hasLive: Boolean(mode.hasLive && mode.token), version: PACKAGE_VERSION });

  // Build tool list. get_bill_history is defined in BOTH the local and live sets
  // (local is the default, token-free path; the live one remains for live-only
  // mode / freshness), so dedupe by name — local listed first, so it wins in
  // hybrid mode. Routing (below) already prefers local when the corpus exists,
  // and falls through to the live handler in live-only mode.
  const seenToolNames = new Set<string>();
  const toolDefs = [
    ...(mode.hasLocal ? LOCAL_TOOL_DEFS : []),
    ...(mode.hasLive ? [...LIVE_TOOL_DEFS, LIVE_SEARCH_TOOL_DEF] : []),
    ...shared.tools,
  ].filter((t) => {
    if (seenToolNames.has(t.name)) return false;
    seenToolNames.add(t.name);
    return true;
  });

  // Build set of local and live tool names for routing
  const localNames = new Set(LOCAL_TOOL_DEFS.map((t) => t.name));
  const liveNames = new Set([
    ...LIVE_TOOL_DEFS.map((t) => t.name),
    LIVE_SEARCH_TOOL_DEF.name,
  ]);

  const server = new Server(
    { name: "nyc-council-mcp", version: PACKAGE_VERSION },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefs }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const safeArgs = (args ?? {}) as Record<string, unknown>;

    // The shared tools (#75, #48): every mode, before any other route.
    if (shared.handles(name)) {
      return shared.call(name, args);
    }

    // Route to local (SQLite) handler
    if (mode.hasLocal && db && localNames.has(name)) {
      let res = handleLocalTool(name, safeArgs, db);
      // #42: the archive can keep a stale meeting status, so in hybrid mode the
      // upcoming meetings' status is checked live (one request).
      if (name === "upcoming_events" && mode.hasLive && mode.token && !res.isError) {
        const token = mode.token;
        const days = typeof safeArgs.days === "number" ? safeArgs.days : 14;
        const local = db;
        res = await checkUpcomingLive(
          res,
          days,
          (from, to) => getEventStatuses(token, from, to),
          (ids) =>
            new Set(
              (local
                .prepare("SELECT event_id FROM events WHERE event_id IN (SELECT value FROM json_each(?))")
                .all(JSON.stringify(ids)) as { event_id: number }[]).map((r) => r.event_id)
            )
        );
      }
      // #25: say when the index was built (and, with no token, that it is unchecked).
      return withSourceNote(res, db, { hasLive: Boolean(mode.hasLive && mode.token) });
    }

    // Route to live search alias
    if (mode.hasLive && mode.token && name === LIVE_SEARCH_TOOL_DEF.name) {
      return handleLiveSearch(safeArgs, mode.token);
    }

    // Route to live API handler
    if (mode.hasLive && mode.token && liveNames.has(name)) {
      const res = await handleLiveTool(name, safeArgs, mode.token);
      // #28: Legistar's person records have no district; the index does.
      if (name === "get_council_member") {
        // #28/#37: BetaNYC's curated facts (labeled as such), then districts if indexed.
        const curated = withCurated(res);
        return db ? withMemberTerms(curated, db) : curated;
      }
      return res;
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
