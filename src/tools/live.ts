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
} from "../legistar.js";
import { json } from "./util.js";

const LIVE_TOOL_DEFS = [
  {
    name: "get_bill",
    description:
      "Get a specific bill by its intro/file number (e.g. '0001-2024'). Returns the current authoritative record from the live Legistar API.",
    inputSchema: {
      type: "object",
      properties: {
        file_number: { type: "string", description: "Bill file number, e.g. '0001-2024'" },
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
      "Get the vote record for a specific agenda item by its event item ID. Shows how each member voted. Live API data.",
    inputSchema: {
      type: "object",
      properties: {
        event_item_id: {
          type: "number",
          description: "Event item ID (from bill history MatterHistoryEventId)",
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
  {
    // Live-API search alias (calls the Legistar search endpoint). Separate
    // from the SQLite search_bills / search_legislation tools.
    name: "search_legislation_live",
    description:
      "Search NYC Council legislation via the live Legistar API. Slower than search_bills but always current. Use when the local index may be stale.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term (title or file number)" },
        limit: { type: "number", description: "Max results to return (default 20, max 50)" },
      },
      required: ["query"],
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
        return json(results[0]);
      }

      case "get_bill_history": {
        const { matter_id } = z.object({ matter_id: z.number() }).parse(args);
        const results = await getBillHistory(token, matter_id);
        return json(results);
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
        return json(results);
      }

      case "get_council_member": {
        const { name: memberName } = z.object({ name: z.string() }).parse(args);
        const results = await getCouncilMember(token, memberName);
        return json(results);
      }

      case "get_committee": {
        const { name: committeeName } = z.object({ name: z.string() }).parse(args);
        const results = await getCommittee(token, committeeName);
        return json(results);
      }

      case "get_votes": {
        const { event_item_id } = z.object({ event_item_id: z.number() }).parse(args);
        const results = await getVotes(token, event_item_id);
        return json(results);
      }

      case "list_recent_legislation": {
        const { limit } = z
          .object({ limit: z.number().max(50).optional() })
          .parse(args ?? {});
        const results = await listRecentLegislation(token, limit ?? 25);
        return json(results);
      }

      case "search_legislation_live": {
        const { query, limit } = z
          .object({ query: z.string(), limit: z.number().max(50).optional() })
          .parse(args);
        const results = await searchLegislation(token, query, limit ?? 20);
        return json(results);
      }

      default:
        return { content: [{ type: "text", text: `Unknown live tool: ${name}` }], isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
}
