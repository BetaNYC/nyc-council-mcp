/**
 * SQLite-backed fast-path tools.
 * All queries run against the local index built by `nyc-council-mcp index`.
 * Sub-second response time for search, aggregation, and voting history.
 */

import { z } from "zod";
import type Database from "better-sqlite3";
import {
  searchBills,
  searchEvents,
  listCommittees,
  recentBills,
  upcomingEvents,
  aggregateBills,
  voteBreakdown,
  getVotingRecord,
  coSponsors,
  getBillHearings,
  getEventBills,
} from "../db/queries.js";
import { json } from "./util.js";

const SEARCH_BILLS_DEF = {
  name: "search_bills",
  description:
    "Full-text search across NYC Council bills using the local index. Sub-second response. " +
    "Returns file number, title, status, committee, intro date, and sponsors. " +
    "Optionally filter by agency (uses role-context snippets), status, or committee.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search terms (full-text)" },
      limit: { type: "number", description: "Max results (default 25, max 100)" },
      agency: {
        type: "string",
        description:
          "NYC agency key or name (e.g. 'DEP', 'NYPD', 'department of transportation'). " +
          "Adds a role-context snippet showing HOW the agency is mentioned.",
      },
      status: { type: "string", description: "Filter by status (e.g. 'Enacted', 'Laid Over')" },
      committee: { type: "string", description: "Filter by committee name" },
    },
    required: ["query"],
  },
};

export const LOCAL_TOOL_DEFS = [
  SEARCH_BILLS_DEF,
  {
    ...SEARCH_BILLS_DEF,
    name: "search_legislation",
    description:
      "Alias for search_bills. Full-text search across NYC Council legislation using the local index.",
  },
  {
    name: "search_events",
    description:
      "Full-text search across committee hearings and events in the local index.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms" },
        limit: { type: "number", description: "Max results (default 25)" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_committees",
    description:
      "List all NYC Council committees with bill counts and event counts from the local index.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "recent_bills",
    description:
      "Bills introduced in the last N days, sorted newest first.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Look-back window in days (default 30)" },
        limit: { type: "number", description: "Max results (default 50)" },
      },
    },
  },
  {
    name: "upcoming_events",
    description:
      "Scheduled committee hearings and events in the next N days from the local index. " +
      "Note: the index may be 1–7 days stale. Use get_upcoming_hearings for real-time data.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Days ahead to look (default 14)" },
        limit: { type: "number", description: "Max results (default 50)" },
      },
    },
  },
  {
    name: "aggregate_bills",
    description:
      "Count bills grouped by status, type, committee, or year. Useful for trend analysis.",
    inputSchema: {
      type: "object",
      properties: {
        group_by: {
          type: "string",
          enum: ["status", "type", "committee", "year"],
          description: "Dimension to aggregate on",
        },
      },
      required: ["group_by"],
    },
  },
  {
    name: "vote_breakdown",
    description:
      "Every council member's vote on a specific bill, identified by file number (e.g. '0001-2024').",
    inputSchema: {
      type: "object",
      properties: {
        file_number: { type: "string", description: "Bill file number" },
      },
      required: ["file_number"],
    },
  },
  {
    name: "get_voting_record",
    description:
      "All votes cast by a named council member, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        member_name: { type: "string", description: "Full or partial council member name" },
        limit: { type: "number", description: "Max results (default 50)" },
      },
      required: ["member_name"],
    },
  },
  {
    name: "co_sponsors",
    description:
      "Council members who most frequently co-sponsor bills with a given member.",
    inputSchema: {
      type: "object",
      properties: {
        member_name: { type: "string", description: "Full or partial council member name" },
        limit: { type: "number", description: "Number of top co-sponsors to return (default 20)" },
      },
      required: ["member_name"],
    },
  },
  {
    name: "get_bill_hearings",
    description:
      "Events where a bill appeared on the agenda, identified by file number.",
    inputSchema: {
      type: "object",
      properties: {
        file_number: { type: "string", description: "Bill file number" },
      },
      required: ["file_number"],
    },
  },
  {
    name: "get_event_bills",
    description:
      "All bills on a specific event's agenda, identified by event ID.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "number", description: "Legistar event ID" },
      },
      required: ["event_id"],
    },
  },
];

export function handleLocalTool(
  name: string,
  args: Record<string, unknown>,
  db: Database.Database
): { content: Array<{ type: string; text: string }>; isError?: boolean } {
  try {
    switch (name) {
      case "search_bills":
      case "search_legislation": {
        const { query, limit, agency, status, committee } = z
          .object({
            query: z.string(),
            limit: z.number().max(100).optional(),
            agency: z.string().optional(),
            status: z.string().optional(),
            committee: z.string().optional(),
          })
          .parse(args);
        const results = searchBills(db, query, { limit, agency, status, committee });
        return json(results);
      }

      case "search_events": {
        const { query, limit } = z
          .object({ query: z.string(), limit: z.number().optional() })
          .parse(args);
        const results = searchEvents(db, query, { limit });
        return json(results);
      }

      case "list_committees": {
        const results = listCommittees(db);
        return json(results);
      }

      case "recent_bills": {
        const { days, limit } = z
          .object({ days: z.number().optional(), limit: z.number().optional() })
          .parse(args ?? {});
        const results = recentBills(db, { days, limit });
        return json(results);
      }

      case "upcoming_events": {
        const { days, limit } = z
          .object({ days: z.number().optional(), limit: z.number().optional() })
          .parse(args ?? {});
        const results = upcomingEvents(db, { days, limit });
        return json(results);
      }

      case "aggregate_bills": {
        const { group_by } = z
          .object({ group_by: z.enum(["status", "type", "committee", "year"]) })
          .parse(args);
        const results = aggregateBills(db, group_by);
        return json(results);
      }

      case "vote_breakdown": {
        const { file_number } = z.object({ file_number: z.string() }).parse(args);
        const results = voteBreakdown(db, file_number);
        return json(results);
      }

      case "get_voting_record": {
        const { member_name, limit } = z
          .object({ member_name: z.string(), limit: z.number().optional() })
          .parse(args);
        const results = getVotingRecord(db, member_name, { limit });
        return json(results);
      }

      case "co_sponsors": {
        const { member_name, limit } = z
          .object({ member_name: z.string(), limit: z.number().optional() })
          .parse(args);
        const results = coSponsors(db, member_name, { limit });
        return json(results);
      }

      case "get_bill_hearings": {
        const { file_number } = z.object({ file_number: z.string() }).parse(args);
        const results = getBillHearings(db, file_number);
        return json(results);
      }

      case "get_event_bills": {
        const { event_id } = z.object({ event_id: z.number() }).parse(args);
        const results = getEventBills(db, event_id);
        return json(results);
      }

      default:
        return { content: [{ type: "text", text: `Unknown local tool: ${name}` }], isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
}
