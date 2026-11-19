/**
 * Live Legistar API tools (confirm path).
 * The original live tools from BetaNYC/nyc-council-mcp, refactored
 * into a registration function, plus tools added since (see CHANGELOG).
 */

import { z } from "zod";
import {
  searchLegislation,
  getBill,
  getBillHistory,
  getMatterAttachments,
  getUpcomingHearingsReport,
  getCouncilMemberMatches,
  COUNCIL_MEMBER_MAX,
  getCommittee,
  getVotes,
  listRecentLegislation,
  legistarUrl,
  summarizeHearing,
  UPCOMING_HEARINGS_MAX,
  type LegistarMatter,
} from "../legistar.js";
import { failure } from "./errors.js";

import { json } from "./json.js";
import { annotateTools, provenance } from "../betanyc-tools.js";
import { SOURCE_LINK, LIVE_SOURCE, LIVE_MODIFIED, LIVE_MODIFIED_HEARINGS } from "./source-links.js";

// Add a human-openable legistar_url to a matter record (any type — see
// legistarUrl). get_bill_history returns MatterHistory rows, not matters, so
// they get no URL here.
function withLegistarUrl(m: LegistarMatter): LegistarMatter & { legistar_url: string | null } {
  return { ...m, legistar_url: legistarUrl(m.MatterId) };
}

// Every live tool only reads, from the live Legistar API (openWorldHint true, #82).
const LIVE_TOOL_DEFS = annotateTools([
  {
    name: "get_bill",
    description:
      "Get a specific bill by its intro/file number from the live Legistar API. Legistar file numbers are type-prefixed (e.g. 'Int 0349-2024', 'Res 0232-2024'). A type-prefixed number returns that one matter. A bare 'NNNN-YYYY' number is AMBIGUOUS — the same number can be both an Introduction and a Resolution; if it matches more than one matter the call is REJECTED with an error naming every match, and you re-call with the exact type-prefixed file number. A single match returns the authoritative record.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        file_number: { type: "string", description: "Bill file number, e.g. 'Int 0349-2024' or '0349-2024'" },
      },
      required: ["file_number"],
    },
  },
  {
    name: "get_bill_history",
    description:
      "Get the full legislative history of a bill — hearings, referrals, votes, and status changes. Live API data, authoritative.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        matter_id: {
          type: "number",
          description: "Legistar matter ID (returned by search_bills or get_bill)",
        },
      },
      required: ["matter_id"],
    },
  },
  {
    name: "get_bill_attachments",
    description:
      "List the files attached to a bill or other matter — committee reports, resolution text, charts, hearing transcripts, agendas — from the live Legistar API. Each row has MatterAttachmentName and MatterAttachmentHyperlink (a direct download URL). Takes the numeric matter id (MatterId from get_bill or search_legislation_live; matter_id from the local tools). Many matters have none: [] is a normal answer.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        matter_id: {
          type: "number",
          description: "Legistar matter ID (MatterId / matter_id), not the file number",
        },
      },
      required: ["matter_id"],
    },
  },
  {
    name: "get_upcoming_hearings",
    description:
      "List upcoming NYC Council committee hearings and Stated meetings. Real-time data — use this for scheduling, not the local index. Each event's EventItems array is populated with its agenda items (the bills/matters on the agenda) via a follow-up call per event; EventItems is null when that agenda could not be fetched (a note says why). Pass include_agenda=false to skip that and return events faster with EventItems empty. Returns a short shape by default (detail='summary'); detail='full' returns every Legistar field. A stated meeting can carry 100+ agenda items: for those, use include_agenda=false and page the agenda with get_event_bills.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        days_ahead: {
          type: "number",
          description: "How many days ahead to look (default 14, max 90)",
        },
        detail: {
          type: "string",
          enum: ["summary", "full"],
          description:
            "'summary' (default): date, time, body, location, agenda status and links, and per agenda item its id, matter file/name/type/status, legistar_url and a title cut at 300 characters; null fields dropped. 'full': every Legistar field, unchanged.",
        },
        include_agenda: {
          type: "boolean",
          description:
            "Whether to populate each event's EventItems (agenda items) via a per-event follow-up call (default true). Set false for a faster response when you only need the hearing schedule, not what's on each agenda.",
        },
      },
    },
  },
  {
    name: "get_council_member",
    description:
      "Look up an NYC Council member by name. Returns current contact info and active status. " +
      "PersonWWW2 may carry a PersonWWW2_warning (and the original value in PersonWWW2_upstream) when the upstream link is known or suspected wrong. " +
      "Adds the 'curated' block (BetaNYC's checked facts, not official records). " +
      "With a local index, district and council terms are added too.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", description: "Full or partial name of the council member" },
      },
      required: ["name"],
    },
  },
  {
    name: "get_committee",
    description: "Look up an NYC Council committee by name. Returns current membership count and details.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", description: "Full or partial committee name" },
      },
      required: ["name"],
    },
  },
  {
    name: "get_votes",
    description:
      "Get the vote record for a specific agenda item by its EventItemId. Shows how each member voted. Live API data — use for freshness. For a bill's roll call from the local corpus, prefer vote_breakdown (grouped roll calls with a positions-only tally) or the local get_bill_history, which returns each action's event_item_id directly. EventItemIds also come from an event's agenda items (GET /events/{EventId}/eventitems) — e.g. the EventItemId field inside each event returned by get_upcoming_hearings. Note: the live get_bill_history's MatterHistoryEventId is an EVENT id, not an event ITEM id, whereas each local history action's event_item_id IS the id this tool takes.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        event_item_id: {
          type: "number",
          description:
            "EventItemId of the agenda item (from /events/{EventId}/eventitems, e.g. the EventItems array in get_upcoming_hearings results)",
        },
      },
      required: ["event_item_id"],
    },
  },
  {
    name: "list_recent_legislation",
    description:
      "List the most recently introduced NYC Council legislation. Use this to catch bills introduced since the last index update.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "number", description: "Number of items to return (default 25, max 50; a larger limit is lowered to 50)" },
      },
    },
  },
], true);

export { LIVE_TOOL_DEFS };

type LiveResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

/** Every live data answer ends with its source, a link and the time it was fetched (#84, #85).
 * The source line says the answer is a copy BetaNYC modified, as about_data does for the live
 * source (DATA-SOURCES.json, changes.changed), and that Legistar is the official record. */
export function liveSourceLine(name: string, now: Date = new Date()): string {
  return provenance(
    { sourceName: `${LIVE_SOURCE.sourceName}, ${name === "get_upcoming_hearings" ? LIVE_MODIFIED_HEARINGS : LIVE_MODIFIED}`, publisher: LIVE_SOURCE.publisher, sourceUrl: SOURCE_LINK[name], kind: "live" },
    now
  ).text;
}

function withLiveSource(name: string, res: LiveResult): LiveResult {
  if (res.isError) return res;
  return { ...res, content: [...res.content, { type: "text", text: liveSourceLine(name) }] };
}

/** A limit must be a whole number of at least 1; one above the tool's maximum is allowed here
 * and lowered to it (as the local list tools do). */
const limitArg = () =>
  z.number().int("limit must be a whole number").min(1, "limit must be 1 or more").optional();

/** The most rows list_recent_legislation and search_legislation_live return. */
export const LIVE_LIST_MAX = 50;

/**
 * A list cut at the limit (#86): the caller fetched limit + 1 rows, so one more means more exist.
 * `asked` is the caller's limit: when it is over `max`, `max` was used and a note says so.
 */
function capped(rows: unknown[], asked: number | undefined, fallback: number, max: number, how: string): LiveResult {
  const limit = Math.min(asked ?? fallback, max);
  const notes: string[] = [];
  if (asked !== undefined && asked > max) notes.push(`limit ${asked} is over this tool's maximum of ${max}, so ${max} was used.`);
  if (rows.length > limit) {
    const raise = limit < max ? `Raise limit (up to ${max}) or ${how}.` : `${how[0].toUpperCase()}${how.slice(1)}.`;
    notes.push(`Showing the first ${limit} results; more are available. ${raise}`);
  }
  const body = json(rows.slice(0, limit)).content[0];
  return notes.length ? { content: [body, { type: "text", text: notes.join(" ") }] } : { content: [body] };
}

export async function handleLiveTool(name: string, args: Record<string, unknown>, token: string): Promise<LiveResult> {
  return withLiveSource(name, await runLiveTool(name, args, token));
}

async function runLiveTool(
  name: string,
  args: Record<string, unknown>,
  token: string
): Promise<LiveResult> {
  try {
    switch (name) {
      case "get_bill": {
        const { file_number } = z.object({ file_number: z.string() }).strict().parse(args);
        const results = await getBill(token, file_number);
        if (results.length === 0) {
          return { content: [{ type: "text", text: `No bill found with file number ${file_number}.` }] };
        }
        if (results.length > 1) {
          // A bare NNNN-YYYY is ambiguous: the same number can exist as several
          // matter types (e.g. Int 0540-2026 AND Res 0540-2026). Reject and name
          // every match rather than silently pick one (#27) — the caller re-calls
          // with the exact type-prefixed file number.
          const files = results.map((m) => m.MatterFile).join(", ");
          return {
            isError: true,
            content: [{
              type: "text",
              text: `Ambiguous file number "${file_number}": it matches ${results.length} matters — ${files}. Re-call get_bill with the exact type-prefixed file number (e.g. "${results[0].MatterFile}").`,
            }],
          };
        }
        return json(withLegistarUrl(results[0]));
      }

      case "get_bill_history": {
        const { matter_id } = z.object({ matter_id: z.number() }).strict().parse(args);
        const results = await getBillHistory(token, matter_id);
        return json(results);
      }

      case "get_bill_attachments": {
        const { matter_id } = z.object({ matter_id: z.number().int().positive() }).strict().parse(args);
        const results = await getMatterAttachments(token, matter_id);
        // MatterAttachmentBinary is null in every NYC row (the file is at the
        // hyperlink), so drop it rather than send a dead field.
        const rows = results.map(({ MatterAttachmentBinary: _bin, ...rest }) => rest);
        return json(rows);
      }

      case "get_upcoming_hearings": {
        const { days_ahead, include_agenda, detail } = z
          .object({
            days_ahead: z.number().max(90).optional(),
            include_agenda: z.boolean().optional(),
            detail: z.enum(["summary", "full"]).optional(),
          })
          .strict().parse(args ?? {});
        const { events: results, missingAgendas } = await getUpcomingHearingsReport(
          token,
          days_ahead ?? 14,
          include_agenda ?? true
        );
        // #22: short shape by default; the raw payload only on request.
        const out = (detail ?? "summary") === "full" ? results : results.map(summarizeHearing);
        const notes: string[] = [];
        if (results.length >= UPCOMING_HEARINGS_MAX) {
          notes.push(`Showing the first ${UPCOMING_HEARINGS_MAX} meetings, the most Legistar is asked for; there may be more. Use a smaller days_ahead.`);
        }
        if (missingAgendas.length > 0) {
          const list = missingAgendas
            .map((m) => `${m.EventId} (${String(m.EventDate ?? "").slice(0, 10)}, ${m.EventBodyName}): ${m.reason}`)
            .join("; ");
          notes.push(
            `The agenda is missing for ${missingAgendas.length} of ${results.length} meetings, so their EventItems are null (not fetched; this does not mean the agenda is empty): ${list}. ` +
              `Try again in a minute, or call with include_agenda=false and read one meeting's agenda with get_event_bills (needs the local index).`
          );
        }
        if (notes.length === 0) return json(out);
        return { content: [json(out).content[0], ...notes.map((text) => ({ type: "text", text }))] };
      }

      case "get_council_member": {
        const { name: memberName } = z.object({ name: z.string() }).strict().parse(args);
        const { people: results, total } = await getCouncilMemberMatches(token, memberName);
        if (total > COUNCIL_MEMBER_MAX) {
          return {
            content: [
              json(results).content[0],
              {
                type: "text",
                text: `Showing ${results.length} of ${total} active members whose name matches "${memberName}"; more are available. Use more of the name.`,
              },
            ],
          };
        }
        if (results.length > 0) return json(results);
        // Keep the answer a JSON list, and say why it is empty (found on home-hearth, 2026-11-13).
        return {
          content: [
            json(results).content[0],
            {
              type: "text",
              text:
                `No active Council member in Legistar matches "${memberName}". This tool searches active members only; ` +
                `former members are not searched. For a former member's votes, use get_voting_record (needs the local index).`,
            },
          ],
        };
      }

      case "get_committee": {
        const { name: committeeName } = z.object({ name: z.string() }).strict().parse(args);
        const results = await getCommittee(token, committeeName, 11);
        return capped(results, 10, 10, 10, "use more of the committee's name");
      }

      case "get_votes": {
        const { event_item_id } = z.object({ event_item_id: z.number() }).strict().parse(args);
        const results = await getVotes(token, event_item_id);
        if (results.length > 0) return json(results);
        // An empty list is not "nobody voted": say what it can mean (found in the live check, 2026-11-19).
        return {
          content: [
            json(results).content[0],
            {
              type: "text",
              text:
                `Legistar has no votes recorded for agenda item ${event_item_id}. The item may not have been voted on yet, ` +
                `or it was not a roll call (hearings and oversight items have none). Check the meeting's page on the Council's calendar.`,
            },
          ],
        };
      }

      case "list_recent_legislation": {
        const { limit } = z
          .object({ limit: limitArg() })
          .strict().parse(args ?? {});
        const results = await listRecentLegislation(token, Math.min(limit ?? 25, LIVE_LIST_MAX) + 1);
        return capped(results.map(withLegistarUrl), limit, 25, LIVE_LIST_MAX, "use search_legislation_live or recent_bills");
      }

      default:
        return { content: [{ type: "text", text: `Unknown live tool: ${name}` }], isError: true };
    }
  } catch (err) {
    return failure(err, name, LIVE_TOOL_DEFS, token);
  }
}

// Also keep search_legislation as a live-API alias (calls the Legistar search endpoint)
// This is separate from the SQLite search_bills / search_legislation tools.
export const LIVE_SEARCH_TOOL_DEF = annotateTools([{
  name: "search_legislation_live",
  description:
    "Search NYC Council legislation via the live Legistar API. Slower than search_bills but always current — use when the local index may be stale. " +
    "Multi-word queries match matters whose title contains ALL the words (in any order), so 'section 254 capital' works — you do NOT need a single generic token. Wrap a phrase in double quotes to require those words to be adjacent. " +
    "Note: Legistar's OData API has no full-text relevance ranking, so results are ordered by introduction date, not by how well they match. To find OLDER legislation, set order='date_asc' (oldest first) rather than raising the limit.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", description: "Search terms. Multiple words are AND-ed (all must appear in the title/name); quote a \"phrase\" to require adjacency." },
      limit: { type: "number", description: "Max results to return (default 20, max 50; a larger limit is lowered to 50)" },
      order: {
        type: "string",
        enum: ["date_desc", "date_asc"],
        description: "Sort by introduction date: 'date_desc' (newest first, default) or 'date_asc' (oldest first — use to reach historical legislation).",
      },
    },
    required: ["query"],
  },
}], true)[0];

export async function handleLiveSearch(args: Record<string, unknown>, token: string): Promise<LiveResult> {
  return withLiveSource(LIVE_SEARCH_TOOL_DEF.name, await runLiveSearch(args, token));
}

async function runLiveSearch(args: Record<string, unknown>, token: string): Promise<LiveResult> {
  // Every failure is an isError answer, as in handleLiveTool. Re-throwing turned a bad
  // argument or an upstream failure into an MCP protocol error (found on home-hearth, 2026-11-13).
  try {
    const { query, limit, order } = z
      .object({
        query: z.string(),
        limit: limitArg(),
        order: z.enum(["date_desc", "date_asc"]).optional(),
      })
      .strict().parse(args);
    const results = await searchLegislation(token, query, Math.min(limit ?? 20, LIVE_LIST_MAX) + 1, order ?? "date_desc");
    return capped(results.map(withLegistarUrl), limit, 20, LIVE_LIST_MAX, "add words to the query, or set order='date_asc' for the oldest");
  } catch (err) {
    return failure(err, LIVE_SEARCH_TOOL_DEF.name, [LIVE_SEARCH_TOOL_DEF], token);
  }
}
