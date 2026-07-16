/**
 * Live Legistar API tools (confirm path).
 * These are the 8 original tools from BetaNYC/nyc-council-mcp, refactored
 * into a registration function. No logic has changed.
 */

import { z } from "zod";
import {
  searchLegislation,
  getBill,
  getBillHistory,
  getUpcomingHearings,
  getCouncilMember,
  getCommittee,
  getVotes,
  listRecentLegislation,
  legistarUrl,
  type LegistarMatter,
} from "../legistar.js";

// Add a human-openable legistar_url to a matter record (Introductions only;
// null otherwise — see legistarUrl). get_bill_history returns MatterHistory
// rows, which carry no MatterFile, so no URL is possible there.
function withLegistarUrl(m: LegistarMatter): LegistarMatter & { legistar_url: string | null } {
  return { ...m, legistar_url: legistarUrl(m.MatterFile) };
}

const LIVE_TOOL_DEFS = [
  {
    name: "get_bill",
    description:
      "Get a specific bill by its intro/file number. Legistar file numbers are type-prefixed (e.g. 'Int 0349-2024', 'Res 0232-2024'); if you pass a bare 'NNNN-YYYY' number, the tool retries with the common prefixes (Int, Res, LU) automatically. Returns the current authoritative record from the live Legistar API.",
    inputSchema: {
      type: "object",
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
    name: "get_upcoming_hearings",
    description:
      "List upcoming NYC Council committee hearings and Stated meetings. Real-time data — use this for scheduling, not the local index. Each event's EventItems array is populated with its agenda items (the bills/matters on the agenda) via a follow-up call per event; pass include_agenda=false to skip that and return events faster with EventItems empty.",
    inputSchema: {
      type: "object",
      properties: {
        days_ahead: {
          type: "number",
          description: "How many days ahead to look (default 14, max 90)",
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
    description: "Look up an NYC Council member by name. Returns current contact info and active status.",
    inputSchema: {
      type: "object",
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
      properties: {
        name: { type: "string", description: "Full or partial committee name" },
      },
      required: ["name"],
    },
  },
  {
    name: "get_votes",
    description:
      "Get the vote record for a specific agenda item by its EventItemId. Shows how each member voted. Live API data. EventItemIds come from an event's agenda items (GET /events/{EventId}/eventitems) — e.g. the EventItemId field inside each event returned by get_upcoming_hearings. Note: MatterHistoryEventId from get_bill_history is an EVENT id, not an event ITEM id; to go from bill history to votes, fetch that event's eventitems and pick the item matching the bill.",
    inputSchema: {
      type: "object",
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
      properties: {
        limit: { type: "number", description: "Number of items to return (default 25, max 50)" },
      },
    },
  },
];

export { LIVE_TOOL_DEFS };

export async function handleLiveTool(
  name: string,
  args: Record<string, unknown>,
  token: string
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    switch (name) {
      case "get_bill": {
        const { file_number } = z.object({ file_number: z.string() }).parse(args);
        const results = await getBill(token, file_number);
        if (results.length === 0) {
          return { content: [{ type: "text", text: `No bill found with file number ${file_number}.` }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(withLegistarUrl(results[0]), null, 2) }] };
      }

      case "get_bill_history": {
        const { matter_id } = z.object({ matter_id: z.number() }).parse(args);
        const results = await getBillHistory(token, matter_id);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "get_upcoming_hearings": {
        const { days_ahead, include_agenda } = z
          .object({
            days_ahead: z.number().max(90).optional(),
            include_agenda: z.boolean().optional(),
          })
          .parse(args ?? {});
        const results = await getUpcomingHearings(
          token,
          days_ahead ?? 14,
          include_agenda ?? true
        );
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "get_council_member": {
        const { name: memberName } = z.object({ name: z.string() }).parse(args);
        const results = await getCouncilMember(token, memberName);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "get_committee": {
        const { name: committeeName } = z.object({ name: z.string() }).parse(args);
        const results = await getCommittee(token, committeeName);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "get_votes": {
        const { event_item_id } = z.object({ event_item_id: z.number() }).parse(args);
        const results = await getVotes(token, event_item_id);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "list_recent_legislation": {
        const { limit } = z
          .object({ limit: z.number().max(50).optional() })
          .parse(args ?? {});
        const results = await listRecentLegislation(token, limit ?? 25);
        return { content: [{ type: "text", text: JSON.stringify(results.map(withLegistarUrl), null, 2) }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown live tool: ${name}` }], isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
}

// Also keep search_legislation as a live-API alias (calls the Legistar search endpoint)
// This is separate from the SQLite search_bills / search_legislation tools.
export const LIVE_SEARCH_TOOL_DEF = {
  name: "search_legislation_live",
  description:
    "Search NYC Council legislation via the live Legistar API. Slower than search_bills but always current — use when the local index may be stale. " +
    "Multi-word queries match matters whose title contains ALL the words (in any order), so 'section 254 capital' works — you do NOT need a single generic token. Wrap a phrase in double quotes to require those words to be adjacent. " +
    "Note: Legistar's OData API has no full-text relevance ranking, so results are ordered by introduction date, not by how well they match. To find OLDER legislation, set order='date_asc' (oldest first) rather than raising the limit.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search terms. Multiple words are AND-ed (all must appear in the title/name); quote a \"phrase\" to require adjacency." },
      limit: { type: "number", description: "Max results to return (default 20, max 50)" },
      order: {
        type: "string",
        enum: ["date_desc", "date_asc"],
        description: "Sort by introduction date: 'date_desc' (newest first, default) or 'date_asc' (oldest first — use to reach historical legislation).",
      },
    },
    required: ["query"],
  },
};

export async function handleLiveSearch(
  args: Record<string, unknown>,
  token: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { query, limit, order } = z
    .object({
      query: z.string(),
      limit: z.number().max(50).optional(),
      order: z.enum(["date_desc", "date_asc"]).optional(),
    })
    .parse(args);
  const results = await searchLegislation(token, query, limit ?? 20, order ?? "date_desc");
  return { content: [{ type: "text", text: JSON.stringify(results.map(withLegistarUrl), null, 2) }] };
}
