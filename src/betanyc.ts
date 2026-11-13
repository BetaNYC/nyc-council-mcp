/**
 * "Where does this data come from?" (#48), on BetaNYC's shared about_data module.
 *
 * The answer comes from DATA-SOURCES.json at the package root, read by the shared module
 * (src/betanyc-tools.ts, a copy of the BetaNYC workspace's scripts/mcp_shared/betanyc-tools.ts:
 * never edit it here). Standard: betanyc-ai-workspace platform/system/about-data-standard.md.
 *
 * 2.8.0 registers about_data only. whats_changed and about_betanyc, the other two shared tools,
 * come in 2.9.0 with a full WHATS-CHANGED.md history. Until then, two things the shared module
 * says about those tools are replaced here so nothing points at a tool this server lacks:
 * the last sentence of the server instructions, and about_data's who_built_this pointer.
 * Delete both replacements when about_betanyc is registered.
 *
 * How current each source is comes from real state, never typed into DATA-SOURCES.json:
 * the index's build time and the district snapshot's fetch time (hooks below), and the
 * curated files' own checked_at (freshness "file" in DATA-SOURCES.json).
 */

import type Database from "better-sqlite3";
import { readFileSync } from "fs";
import {
  BETANYC_INSTRUCTIONS,
  createBetanycTools,
  type ToolDefinition,
  type ToolResult,
} from "./betanyc-tools.js";

export const SERVER_NAME = "nyc-council-mcp";
export const REPO_URL = "https://github.com/BetaNYC/nyc-council-mcp";
export const DATA_SOURCES_PATH = new URL("../DATA-SOURCES.json", import.meta.url);
const TERMS_PATH = new URL("../data/council-member-terms.json", import.meta.url);

/** Who built this server, said here until about_betanyc is registered (2.9.0). */
export const WHO_BUILT_THIS =
  `${SERVER_NAME} is built by BetaNYC, a project of the Fund for the City of New York (https://beta.nyc). ` +
  `Code, MIT license: ${REPO_URL}. Questions or corrections: ${REPO_URL}/issues.`;

const POINTER_TO_ABOUT_BETANYC = `Call about_betanyc for who built ${SERVER_NAME} and how to reach them.`;
const LAST_SENTENCE = / For who built this server, call about_betanyc; for recent fixes and corrections, call whats_changed\.$/;

/** The shared instructions without the sentence about the two tools this server does not have yet. */
export const SERVER_INSTRUCTIONS =
  "NYC Council legislation, votes, hearings and members, by BetaNYC. " +
  BETANYC_INSTRUCTIONS.replace(LAST_SENTENCE, "") +
  " Facts in a 'curated' block are BetaNYC's hand-checked assertions, not official records: say so when you use them. " +
  `For who built this server: ${WHO_BUILT_THIS}`;

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

export interface AboutDataContext {
  db: Database.Database | null;
  version: string;
  /** Override for tests; defaults to the DATA-SOURCES.json that ships with the package. */
  dataSourcesText?: string;
}

/** about_data for this server. Throws at startup when DATA-SOURCES.json does not describe it. */
export function createAboutData(ctx: AboutDataContext): {
  tool: ToolDefinition;
  instructions: string;
  call: (args: unknown) => ToolResult;
} {
  const shared = createBetanycTools({
    serverName: SERVER_NAME,
    version: ctx.version,
    repoUrl: REPO_URL,
    // No WHATS-CHANGED.md before 2.9.0: about_data reads it only for corrections, and none are listed.
    whatsChangedText: "",
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
  const tool = shared.tools.find((t) => t.name === "about_data");
  if (!tool) throw new Error("betanyc-tools: about_data is missing from the shared module");
  return {
    tool,
    instructions: SERVER_INSTRUCTIONS,
    call: (args) => {
      const res = shared.call("about_data", args);
      if (res.isError) return res;
      const structured = res.structuredContent
        ? { ...res.structuredContent, who_built_this: WHO_BUILT_THIS }
        : undefined;
      return {
        ...res,
        content: res.content.map((c) => ({ ...c, text: c.text.split(POINTER_TO_ABOUT_BETANYC).join(WHO_BUILT_THIS) })),
        ...(structured ? { structuredContent: structured } : {}),
      };
    },
  };
}
