/**
 * BetaNYC's three shared tools: whats_changed, about_betanyc and about_data (#75, #48).
 *
 * All three come from the shared module, src/betanyc-tools.ts, a copy of the BetaNYC
 * workspace's scripts/mcp_shared/betanyc-tools.ts: never edit it here. Standards:
 * betanyc-ai-workspace platform/system/whats-changed-standard.md § 7 and
 * platform/system/about-data-standard.md § 3.
 *
 * whats_changed and about_betanyc pass through unchanged. about_data gets one thing the module
 * cannot know, kept from 2.8.0 (#67): whether this server is set up for the live Legistar API.
 * With no LEGISTAR_TOKEN the live tools are not listed, so the live source says it is not
 * available here instead of "fetched from the source when you ask", and every answer carries
 * `this_server` ({ live_api, local_index }).
 *
 * How current each source is comes from real state, never typed into DATA-SOURCES.json: the
 * index's build time and the district snapshot's fetch time (hooks below), and the curated
 * files' own checked_at (freshness "file" in DATA-SOURCES.json).
 */

import type Database from "better-sqlite3";
import { readFileSync } from "fs";
import { BETANYC_INSTRUCTIONS, createBetanycTools, type ToolDefinition, type ToolResult } from "./betanyc-tools.js";

export const SERVER_NAME = "nyc-council-mcp";
export const REPO_URL = "https://github.com/BetaNYC/nyc-council-mcp";
export const WHATS_CHANGED_PATH = new URL("../WHATS-CHANGED.md", import.meta.url);
export const DATA_SOURCES_PATH = new URL("../DATA-SOURCES.json", import.meta.url);
const TERMS_PATH = new URL("../data/council-member-terms.json", import.meta.url);

/** The server's MCP instructions: what it covers, then the shared module's own instructions
 * (call about_data, about_betanyc and whats_changed), then this server's rules. */
export const SERVER_INSTRUCTIONS =
  "NYC Council legislation, votes, hearings and members, by BetaNYC. " +
  BETANYC_INSTRUCTIONS +
  " Facts in a 'curated' block were checked by BetaNYC and are not official records: say so when you use them. " +
  "Nothing is invented: a value with no source is left blank.";

const LIVE_AS_OF = "live: fetched from the source when you ask";
const LIVE_UNAVAILABLE = "not available on this server: the live Legistar API is not set up (no LEGISTAR_TOKEN)";

function indexState(db: Database.Database | null, key: string): string | null {
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

export interface SharedToolsContext {
  db: Database.Database | null;
  /** True when LEGISTAR_TOKEN is set, so the live tools can fetch. */
  hasLive: boolean;
  version: string;
  /** Overrides for tests; default to the files that ship with the package. */
  dataSourcesText?: string;
  whatsChangedText?: string;
}

export interface SharedTools {
  tools: ToolDefinition[];
  instructions: string;
  handles: (name: string) => boolean;
  call: (name: string, args: unknown) => ToolResult;
}

/** The three shared tools for this server. Throws at startup on a bad config, or when
 * DATA-SOURCES.json does not describe this server. */
export function createSharedTools(ctx: SharedToolsContext): SharedTools {
  const betanyc = createBetanycTools({
    serverName: SERVER_NAME,
    version: ctx.version,
    repoUrl: REPO_URL,
    whatsChangedPath: WHATS_CHANGED_PATH,
    ...(ctx.whatsChangedText !== undefined ? { whatsChangedText: ctx.whatsChangedText } : {}),
    dataSourcesPath: DATA_SOURCES_PATH,
    ...(ctx.dataSourcesText !== undefined ? { dataSourcesText: ctx.dataSourcesText } : {}),
    freshness: {
      // When this server's local index was built (the indexer writes it).
      index_built: () => indexState(ctx.db, "last_indexed_at"),
      // When the district snapshot loaded into the index was fetched from NYC Open Data;
      // with no index, the snapshot that ships with the package.
      member_terms_fetched: () =>
        ctx.db ? indexState(ctx.db, "member_terms_fetched_at") : snapshotFetchedAt(),
    },
  });

  const thisServer = { live_api: ctx.hasLive, local_index: Boolean(ctx.db) };
  const tools = betanyc.tools.map((t) => (t.name === "about_data" ? withThisServerSchema(t) : t));

  const aboutData = (args: unknown): ToolResult => {
    const res = betanyc.call("about_data", args);
    if (res.isError) return res;
    const fixText = (t: string): string => (ctx.hasLive ? t : t.split(LIVE_AS_OF).join(LIVE_UNAVAILABLE));
    const sc = res.structuredContent as Record<string, unknown> | undefined;
    const structured = sc
      ? {
          ...sc,
          sources: Array.isArray(sc.sources)
            ? sc.sources.map((s: Record<string, unknown>) =>
                !ctx.hasLive && s.as_of_status === "live"
                  ? { ...s, as_of: LIVE_UNAVAILABLE, as_of_status: "unavailable" }
                  : s)
            : sc.sources,
          this_server: thisServer,
        }
      : undefined;
    const serverLine =
      `This server: live Legistar API ${thisServer.live_api ? "set up" : "not set up"}; ` +
      `local index ${thisServer.local_index ? "present" : "not present"}.`;
    return {
      ...res,
      content: res.content.map((c, i) => ({ ...c, text: fixText(c.text) + (i === 0 ? `\n\n${serverLine}` : "") })),
      ...(structured ? { structuredContent: structured } : {}),
    };
  };

  return {
    tools,
    instructions: SERVER_INSTRUCTIONS,
    handles: betanyc.handles,
    call: (name, args) => (name === "about_data" ? aboutData(args) : betanyc.call(name, args)),
  };
}

/** about_data's outputSchema plus `this_server`, so the SDK client's check still passes. */
function withThisServerSchema(tool: ToolDefinition): ToolDefinition {
  const out = tool.outputSchema;
  if (!out) return tool;
  return {
    ...tool,
    outputSchema: {
      ...out,
      properties: {
        ...(out.properties ?? {}),
        this_server: {
          type: "object",
          description: "Whether this server is set up for the live Legistar API and has a local index",
          properties: { live_api: { type: "boolean" }, local_index: { type: "boolean" } },
          required: ["live_api", "local_index"],
        },
      },
    },
  };
}
