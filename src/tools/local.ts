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
  getBillHistoryLocal,
  coSponsors,
  getBillHearings,
  getEventBills,
  getMatter,
  memberRoles,
  committeeRoster,
  districtMember,
} from "../db/queries.js";
import { unknownParamMessage } from "./unknown-param.js";

import { json } from "./json.js";
import { withCurated } from "../curated.js";

// #21: one search tool, two names. search_legislation is the main name because
// it returns every matter type (Introductions, Resolutions, Land Use, Mayor's
// Messages, …), not only bills. search_bills stays as an alias so existing
// callers keep working. The alias is built from the main definition (#36), so
// the two schemas cannot drift.
const SEARCH_LEGISLATION_DEF = {
  name: "search_legislation",
  description:
    "Full-text search across NYC Council legislation in the local index: Introductions, Resolutions, " +
    "Land Use items and every other matter type. Sub-second response. " +
    "Returns file number, title, type, status, committee, intro date, sponsors and legistar_url. " +
    "Optionally filter by agency (uses role-context snippets), status, or committee.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
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
  SEARCH_LEGISLATION_DEF,
  {
    ...SEARCH_LEGISLATION_DEF,
    name: "search_bills",
    description:
      "Alias for search_legislation (same tool, same results). Despite the name, it returns every matter type, not only bills.",
  },
  {
    name: "get_matter",
    description:
      "One matter from the local index, by file number (e.g. 'Int 1122-2024') or Local Law number (e.g. '2025/153'). " +
      "Returns its summary, version ('*' = original text, 'A', 'B'… = amended), Local Law number (null unless enacted), " +
      "attachments (committee reports, fiscal impact statements, transcripts; each with a download link; [] when none), " +
      "legistar_url, and the full text only when include_text is true. No token needed.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        file_number: { type: "string", description: "Type-prefixed file number, e.g. 'Int 1122-2024'" },
        local_law: { type: "string", description: "Local Law number as 'YYYY/NNN', e.g. '2025/153'" },
        include_text: { type: "boolean", description: "Also return the full text (can be over 200,000 characters). Default false." },
      },
    },
  },
  {
    name: "get_member_roles",
    description:
      "A council member's committees (with chairs listed separately), caucuses, party conferences, borough delegations " +
      "and task forces, from Legistar's own membership records in the local index. Current as of today by default; " +
      "pass as_of (YYYY-MM-DD) for a past date, or include_past for the whole history with start/end dates. " +
      "Conference and caucus memberships are memberships only: no party is inferred from them. " +
      "Also returns the member's council district on that date and every council term (from the City's " +
      "uvw5-9znb dataset, shipped as a snapshot). A 'curated' block adds BetaNYC's hand-checked Wikidata/Wikipedia " +
      "link, party (every ballot line won on, from Board of Elections certified results) and office social accounts, " +
      "each with its source; these are not official records. No token needed.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        member_name: { type: "string", description: "Full or partial name; middle initials and accents optional" },
        as_of: { type: "string", description: "Date YYYY-MM-DD (default today)" },
        include_past: { type: "boolean", description: "Return every membership ever, with dates (ignores as_of)" },
      },
      required: ["member_name"],
    },
  },
  {
    name: "committee_roster",
    description:
      "Who sits on a Council committee, chair first, from Legistar's membership records in the local index. " +
      "Matches any committee whose name contains the words given (e.g. 'technology'). Current as of today by default; " +
      "as_of (YYYY-MM-DD) for a past date, or include_past for everyone who ever served. No token needed.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        committee: { type: "string", description: "Committee name or part of it" },
        as_of: { type: "string", description: "Date YYYY-MM-DD (default today)" },
        include_past: { type: "boolean", description: "Everyone who ever served, with dates (ignores as_of)" },
      },
      required: ["committee"],
    },
  },
  {
    name: "district_member",
    description:
      "Who held a Council district (1-51) on a date, from the City's list of council terms (NYC Open Data " +
      "uvw5-9znb, shipped as a dated snapshot). A seat nobody held on that date is 'vacant': the last member is " +
      "given as 'previous', never as current. Default date is today. No token needed.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        district: { type: "integer", minimum: 1, maximum: 51, description: "Council district, 1 to 51" },
        as_of: { type: "string", description: "Date YYYY-MM-DD (default today)" },
      },
      required: ["district"],
    },
  },
  {
    name: "search_events",
    description:
      "Full-text search across committee hearings and events in the local index.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
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
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "recent_bills",
    description:
      "Bills introduced in the last N days, sorted newest first.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
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
      "When LEGISTAR_TOKEN is set, each meeting's agenda_status is checked against the live API " +
      "(status_checked_live; the index's value is kept in agenda_status_index when they differ), " +
      "because the archive can miss a status change such as a deferral. Use get_upcoming_hearings for the full live agenda.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
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
      additionalProperties: false,
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
      additionalProperties: false,
      properties: {
        file_number: { type: "string", description: "Bill file number" },
      },
      required: ["file_number"],
    },
  },
  {
    name: "get_voting_record",
    description:
      "All votes cast by a named council member, newest vote first. Each row has vote_date (when the roll call happened), vote_action and vote_body (e.g. 'Approved, by Council', 'City Council'). intro_date is the bill's introduction date, not the vote date.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        member_name: { type: "string", description: "Full or partial council member name" },
        limit: { type: "number", description: "Max results (default 50)" },
      },
      required: ["member_name"],
    },
  },
  {
    name: "get_bill_history",
    description:
      "A matter's legislative history — hearings, referrals, committee and Council actions, and outcomes — from the local index, in chronological order. No token required. " +
      "Identified by a type-prefixed file number like every sibling tool (e.g. 'Int 1122-2024', 'Res 0540-2026'). A bare 'NNNN-YYYY' that matches more than one matter type is rejected with an error naming each match.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        file_number: { type: "string", description: "Type-prefixed file number, e.g. 'Int 1122-2024'" },
      },
      required: ["file_number"],
    },
  },
  {
    name: "co_sponsors",
    description:
      "Council members who most frequently co-sponsor bills with a given member.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
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
      additionalProperties: false,
      properties: {
        file_number: { type: "string", description: "Bill file number" },
      },
      required: ["file_number"],
    },
  },
  {
    name: "get_event_bills",
    description:
      "Bills and other items on a specific event's agenda, identified by event ID. Paged: returns { event_id, total, offset, limit, items }. A stated meeting can have ~180 items, so the default page is 50; raise offset to read the rest.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        event_id: { type: "number", description: "Legistar event ID" },
        limit: { type: "number", description: "Items per page (default 50, max 500)" },
        offset: { type: "number", description: "Items to skip (default 0)" },
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
          .strict().parse(args);
        const results = searchBills(db, query, { limit, agency, status, committee });
        return json(results);
      }

      case "search_events": {
        const { query, limit } = z
          .object({ query: z.string(), limit: z.number().optional() })
          .strict().parse(args);
        const results = searchEvents(db, query, { limit });
        return json(results);
      }

      case "list_committees": {
        z.object({}).strict().parse(args ?? {});
        const results = listCommittees(db);
        return json(results);
      }

      case "recent_bills": {
        const { days, limit } = z
          .object({ days: z.number().optional(), limit: z.number().optional() })
          .strict().parse(args ?? {});
        const results = recentBills(db, { days, limit });
        return json(results);
      }

      case "upcoming_events": {
        const { days, limit } = z
          .object({ days: z.number().optional(), limit: z.number().optional() })
          .strict().parse(args ?? {});
        const results = upcomingEvents(db, { days, limit });
        return json(results);
      }

      case "aggregate_bills": {
        const { group_by } = z
          .object({ group_by: z.enum(["status", "type", "committee", "year"]) })
          .strict().parse(args);
        const results = aggregateBills(db, group_by);
        return json(results);
      }

      case "vote_breakdown": {
        const { file_number } = z.object({ file_number: z.string() }).strict().parse(args);
        const results = voteBreakdown(db, file_number);
        return json(results);
      }

      case "get_voting_record": {
        const { member_name, limit } = z
          .object({ member_name: z.string(), limit: z.number().optional() })
          .strict().parse(args);
        const results = getVotingRecord(db, member_name, { limit });
        return json(results);
      }

      case "get_bill_history": {
        const { file_number } = z.object({ file_number: z.string() }).strict().parse(args);
        const results = getBillHistoryLocal(db, file_number);
        return json(results);
      }

      case "co_sponsors": {
        const { member_name, limit } = z
          .object({ member_name: z.string(), limit: z.number().optional() })
          .strict().parse(args);
        const results = coSponsors(db, member_name, { limit });
        return json(results);
      }

      case "get_bill_hearings": {
        const { file_number } = z.object({ file_number: z.string() }).strict().parse(args);
        const results = getBillHearings(db, file_number);
        return json(results);
      }

      case "get_member_roles":
      case "committee_roster": {
        const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "as_of must be YYYY-MM-DD");
        if (name === "get_member_roles") {
          const { member_name, as_of, include_past } = z
            .object({ member_name: z.string(), as_of: date.optional(), include_past: z.boolean().optional() })
            .strict()
            .parse(args);
          return withCurated(json(memberRoles(db, member_name, { as_of, include_past })));
        }
        const { committee, as_of, include_past } = z
          .object({ committee: z.string(), as_of: date.optional(), include_past: z.boolean().optional() })
          .strict()
          .parse(args);
        return json(committeeRoster(db, committee, { as_of, include_past }));
      }

      case "district_member": {
        const { district, as_of } = z
          .object({
            district: z.number().int().min(1).max(51),
            as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "as_of must be YYYY-MM-DD").optional(),
          })
          .strict()
          .parse(args);
        return json(districtMember(db, district, as_of));
      }

      case "get_matter": {
        const { file_number, local_law, include_text } = z
          .object({
            file_number: z.string().optional(),
            local_law: z.string().optional(),
            include_text: z.boolean().optional(),
          })
          .strict()
          .parse(args ?? {});
        if (Boolean(file_number) === Boolean(local_law)) {
          throw new Error("get_matter needs exactly one of file_number or local_law.");
        }
        const m = getMatter(db, { file_number, local_law, include_text });
        if (!m) {
          throw new Error(
            `No matter with ${file_number ? `file number "${file_number}"` : `Local Law number "${local_law}"`} in the local index.`
          );
        }
        return json(m);
      }

      case "get_event_bills": {
        const { event_id, limit, offset } = z
          .object({
            event_id: z.number(),
            limit: z.number().int().min(1).max(500).optional(),
            offset: z.number().int().min(0).optional(),
          })
          .strict()
          .parse(args);
        const results = getEventBills(db, event_id, { limit, offset });
        return json(results);
      }

      default:
        return { content: [{ type: "text", text: `Unknown local tool: ${name}` }], isError: true };
    }
  } catch (err) {
    const message =
      unknownParamMessage(err, name, LOCAL_TOOL_DEFS) ??
      (err instanceof Error ? err.message : String(err));
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
}
