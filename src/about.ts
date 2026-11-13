/**
 * "Where does this data come from?" (#48). One tool, available in every mode,
 * that tells a person who made this server, how it works, and where each kind
 * of data comes from: the source, whether it is official, how it was gathered,
 * and how current it is on this server. Noel, 2026-11-12: be as transparent as
 * possible when people ask about sources, who we are and how this was built.
 *
 * Every tool must appear under some source below; a test enforces it.
 */

import type Database from "better-sqlite3";
import { readFileSync } from "fs";
import { z } from "zod";
import { json } from "./tools/json.js";
import { DEFAULT_DATA_DIR } from "./curated.js";

export const SERVER_INSTRUCTIONS =
  "NYC Council legislation, votes, hearings and members, by BetaNYC. When someone asks where the data comes " +
  "from, how current it is, who made this server or how it was built, call about_data (with a topic if they mean " +
  "one kind of data) and answer from it, naming the source. Facts in a 'curated' block are BetaNYC's hand-checked " +
  "assertions, not official records: say so when you use them.";

interface Source {
  topic: string;
  what: string;
  source: string;
  source_url: string;
  official: boolean;
  how: string;
  as_of: string;
  tools: string[];
  caveats?: string[];
}

export const ABOUT_TOPICS = [
  "all", "members", "live", "bills", "votes", "events", "committees", "districts", "party", "wikidata", "social",
] as const;

const MEMBER_TOPICS = ["live", "committees", "districts", "party", "wikidata", "social"];

export const ABOUT_TOOL_DEF = {
  name: "about_data",
  description:
    "Where this server's data comes from, who made it (BetaNYC) and how it was built. For each kind of data: the " +
    "source, whether it is an official record or BetaNYC's curation, how it was gathered, and how current it is " +
    "on this server. Use it whenever someone asks about sources, accuracy, freshness or who is behind these answers. " +
    "No token or index needed.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      topic: {
        type: "string",
        enum: [...ABOUT_TOPICS],
        description: "Which data to explain (default all). 'members' covers everything about council members.",
      },
    },
  },
};

function state(db: Database.Database | null, key: string): string | null {
  if (!db) return null;
  try {
    const row = db.prepare("SELECT value FROM index_state WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function fileDate(name: string, key = "checked_at"): string {
  try {
    const data = JSON.parse(readFileSync(new URL(name, DEFAULT_DATA_DIR), "utf8")) as Record<string, unknown>;
    return typeof data[key] === "string" ? (data[key] as string) : "unknown";
  } catch {
    return "file missing from this install";
  }
}

const ARCHIVE = "https://github.com/jehiah/nyc_legislation";
const LEGISTAR_API = "https://council.nyc.gov/legislation/api/";

function sources(db: Database.Database | null, hasLive: boolean): Source[] {
  const built = state(db, "last_indexed_at");
  const commit = state(db, "archive_commit");
  const commitDate = state(db, "archive_commit_date");
  const index = !db
    ? "no local index on this server"
    : `index built ${built ?? "(time unknown)"}` +
      (commit ? ` from jehiah/nyc_legislation@${commit}${commitDate ? ` (${commitDate})` : ""}` : "");
  const archive = (topic: string, what: string, tools: string[], caveats?: string[]): Source => ({
    topic,
    what,
    source: "Legistar, the NYC Council's legislative system, through the jehiah/nyc_legislation archive",
    source_url: ARCHIVE,
    official: true,
    how:
      "The archive copies Legistar's public records most weekdays. This server indexes that copy into a local " +
      "SQLite database and answers from it, with no network call. Local answers end with a line saying when the index was built.",
    as_of: index,
    tools,
    ...(caveats ? { caveats } : {}),
  });
  return [
    {
      topic: "live",
      what: "Bills, their history and files, hearings and agendas, committees, roll-call votes and member contact details, fetched when asked",
      source: "NYC Council Legistar Web API (Granicus)",
      source_url: LEGISTAR_API,
      official: true,
      how: "Read-only requests to the Council's own API at the moment you ask. Needs LEGISTAR_TOKEN.",
      as_of: hasLive ? "live: fetched when you ask" : "the live API is not set up on this server",
      tools: [
        "get_bill", "get_bill_history", "get_bill_attachments", "get_upcoming_hearings", "get_council_member",
        "get_committee", "get_votes", "list_recent_legislation", "search_legislation_live",
      ],
      caveats: [
        "Legistar sometimes changes a meeting's status without updating its timestamp; upcoming_events checks status live when it can.",
      ],
    },
    archive(
      "bills",
      "Introductions, resolutions and land use items: titles, summaries, full text, sponsors, Local Law numbers, attachments, history",
      ["search_legislation", "search_bills", "get_matter", "recent_bills", "aggregate_bills", "get_bill_history", "co_sponsors"],
      ["An empty local answer means 'not in this index', not 'does not exist'."]
    ),
    archive("votes", "Roll-call votes by member, with the date, action and body of each vote", [
      "vote_breakdown", "get_voting_record",
    ]),
    archive("events", "Meetings and hearings, their agendas and the items heard", [
      "search_events", "upcoming_events", "get_event_bills", "get_bill_hearings",
    ]),
    archive(
      "committees",
      "Committee, caucus, conference and delegation memberships with roles and dates (Legistar OfficeRecords)",
      ["get_member_roles", "committee_roster", "list_committees"],
      ["A caucus or party conference is a membership, never a party."]
    ),
    {
      topic: "districts",
      what: "Every council term since 1999, with district",
      source: "NYC Open Data: City Council Members (1999 to Present), dataset uvw5-9znb",
      source_url: "https://data.cityofnewyork.us/d/uvw5-9znb",
      official: true,
      how:
        "A copy of the City's dataset ships with this server (data/council-member-terms.json) and is loaded into the " +
        "index, used as published. A monthly job re-fetches it. Joined to Legistar on person ID, never on names.",
      as_of: state(db, "member_terms_fetched_at") ?? fileDate("council-member-terms.json", "fetched_at"),
      tools: ["district_member", "get_member_roles", "get_council_member"],
      caveats: [
        "The City updates this file late. A seat that looks vacant may have a new member; the answer then names anyone Legistar lists who is missing from the file.",
        "District lines are redrawn, so a past district number may not match today's map.",
      ],
    },
    {
      topic: "party",
      what: "Party: every ballot line each sitting member won on",
      source: "NYC Board of Elections certified results",
      source_url: "https://www.vote.nyc/page/election-results-summary",
      official: false,
      how:
        "Curated by BetaNYC: every ballot line each member won on (NYC has fusion voting) and its votes, copied from the " +
        "Board's certified results for the election that gave them their seat, with a link to that document. Never " +
        "inferred from a caucus or from Wikidata. Shipped in data/council-party.json.",
      as_of: fileDate("council-party.json"),
      tools: ["get_council_member", "get_member_roles"],
      caveats: ["Covers the members seated on the check date only. A row not yet reviewed by a person says so."],
    },
    {
      topic: "wikidata",
      what: "Wikidata item and English Wikipedia article for each sitting member",
      source: "Wikidata and Wikipedia",
      source_url: "https://www.wikidata.org/",
      official: false,
      how:
        "Curated by BetaNYC: each item was checked to be a person whose Wikipedia article names their Council district. " +
        "Shipped in data/council-wikidata.json; nothing is looked up at run time.",
      as_of: fileDate("council-wikidata.json"),
      tools: ["get_council_member", "get_member_roles"],
    },
    {
      topic: "social",
      what: "Office accounts on Bluesky, Instagram, Threads and LinkedIn",
      source: "council.nyc.gov member pages and the Council's Bluesky starter pack; the account's own profile last",
      source_url: "https://council.nyc.gov/",
      official: false,
      how:
        "Curated by BetaNYC: office accounts only, never campaign or personal. 'verified' means council.nyc.gov links it, " +
        "or it is in the Council's Bluesky starter pack and is not a personal or campaign account; " +
        "'likely' means only the account's own bio says it is the office. Shipped in data/council-social.json.",
      as_of: fileDate("council-social.json"),
      tools: ["get_council_member", "get_member_roles"],
    },
  ];
}

export function handleAbout(
  args: unknown,
  ctx: { db: Database.Database | null; hasLive: boolean; version?: string }
): { content: { type: string; text: string }[]; isError?: boolean } {
  const parsed = z.object({ topic: z.enum(ABOUT_TOPICS).optional() }).strict().safeParse(args ?? {});
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Error: topic must be one of: ${ABOUT_TOPICS.join(", ")}.` }],
      isError: true,
    };
  }
  const topic = parsed.data.topic ?? "all";
  const all = sources(ctx.db, ctx.hasLive);
  const picked =
    topic === "all" ? all : topic === "members" ? all.filter((s) => MEMBER_TOPICS.includes(s.topic)) : all.filter((s) => s.topic === topic);
  return json({
    server: "@betanyc/nyc-council-mcp",
    ...(ctx.version ? { version: ctx.version } : {}),
    made_by:
      "BetaNYC, a project of the Fund for the City of New York: New York's civic technology and open-data " +
      "community, working to improve lives in New York through civic design, technology, data, and public-interest technology.",
    website: "https://beta.nyc",
    repository: "https://github.com/BetaNYC/nyc-council-mcp",
    license: "MIT",
    questions_or_corrections: "Open an issue at https://github.com/BetaNYC/nyc-council-mcp/issues",
    how_it_works:
      "An open-source MCP server. Live tools ask the Council's Legistar API when you ask. Local tools answer from an " +
      "index built from a public archive of Legistar. Member facts that no official source publishes in one place " +
      "(party lines, Wikidata, office social accounts) are curated by BetaNYC, each with its source and check date, " +
      "and labeled as not official. Nothing is invented: a value with no source is left blank.",
    this_server: { live_api: ctx.hasLive, local_index: Boolean(ctx.db) },
    sources: picked,
  });
}
