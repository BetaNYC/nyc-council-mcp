#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
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
} from "./legistar.js";

const token = process.env.LEGISTAR_TOKEN;
if (!token) {
  console.error(
    "Error: LEGISTAR_TOKEN environment variable is not set.\n" +
    "Register for a free API key at: https://council.nyc.gov/legislation/api/"
  );
  process.exit(1);
}

const server = new Server(
  { name: "nyc-council-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_legislation",
      description:
        "Search NYC Council legislation by keyword. Returns bills, resolutions, and other matters matching the query.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term (title or file number)" },
          limit: { type: "number", description: "Max results to return (default 20, max 50)" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_bill",
      description:
        "Get a specific bill by its intro/file number (e.g. '0001-2024'). Returns the matter record.",
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
        "Get the full legislative history of a bill — hearings, referrals, votes, and status changes — by its Legistar matter ID.",
      inputSchema: {
        type: "object",
        properties: {
          matter_id: { type: "number", description: "Legistar matter ID (returned by search_legislation or get_bill)" },
        },
        required: ["matter_id"],
      },
    },
    {
      name: "get_upcoming_hearings",
      description:
        "List upcoming NYC Council committee hearings and Stated meetings.",
      inputSchema: {
        type: "object",
        properties: {
          days_ahead: {
            type: "number",
            description: "How many days ahead to look (default 14, max 90)",
          },
        },
      },
    },
    {
      name: "get_council_member",
      description: "Look up an NYC Council member by name.",
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
      description: "Look up an NYC Council committee by name.",
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
        "Get the vote record for a specific agenda item by its event item ID. Shows how each member voted.",
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
      description: "List the most recently introduced NYC Council legislation.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of items to return (default 25, max 50)" },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "search_legislation": {
        const { query, limit } = z
          .object({ query: z.string(), limit: z.number().max(50).optional() })
          .parse(args);
        const results = await searchLegislation(token, query, limit ?? 20);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "get_bill": {
        const { file_number } = z.object({ file_number: z.string() }).parse(args);
        const results = await getBill(token, file_number);
        if (results.length === 0) {
          return { content: [{ type: "text", text: `No bill found with file number ${file_number}.` }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(results[0], null, 2) }] };
      }

      case "get_bill_history": {
        const { matter_id } = z.object({ matter_id: z.number() }).parse(args);
        const results = await getBillHistory(token, matter_id);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "get_upcoming_hearings": {
        const { days_ahead } = z
          .object({ days_ahead: z.number().max(90).optional() })
          .parse(args ?? {});
        const results = await getUpcomingHearings(token, days_ahead ?? 14);
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
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
