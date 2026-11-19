// Plain errors (#92) and a token that never leaks (#87). Legistar takes the token only as a URL
// parameter, so every error path is checked for it: a network error that quotes the URL, an
// upstream body that echoes it, for every live tool.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { handleLiveTool, handleLiveSearch, LIVE_TOOL_DEFS } from "../dist/tools/live.js";
import { handleLocalTool } from "../dist/tools/local.js";
import { CREATE_TABLES } from "../dist/db/schema.js";
import { UPSTREAM_BODY_MAX } from "../dist/betanyc-tools.js";

const TOKEN = "s3cr3t-T0KEN+/=";
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const ARGS = {
  get_bill: { file_number: "Int 0001-2024" }, get_bill_history: { matter_id: 1 }, get_bill_attachments: { matter_id: 1 },
  get_upcoming_hearings: { include_agenda: false }, get_council_member: { name: "Brewer" }, get_committee: { name: "Health" },
  get_votes: { event_item_id: 1 }, list_recent_legislation: {},
};

async function everyLiveTool() {
  const out = [];
  for (const t of LIVE_TOOL_DEFS) out.push([t.name, await handleLiveTool(t.name, ARGS[t.name], TOKEN)]);
  out.push(["search_legislation_live", await handleLiveSearch({ query: "x" }, TOKEN)]);
  return out;
}

const text = (res) => res.content.map((c) => c.text).join("\n");

test("a network error that quotes the request URL never shows the token", async () => {
  globalThis.fetch = async (url) => { throw new TypeError(`fetch failed for ${url}`); };
  for (const [name, res] of await everyLiveTool()) {
    assert.equal(res.isError, true, name);
    assert.ok(!text(res).includes(TOKEN) && !text(res).includes(encodeURIComponent(TOKEN)), `${name}: ${text(res)}`);
    assert.match(text(res), /Could not reach the Legistar API/);
  }
});

test("an upstream error body that echoes the token never shows it, and is cut to 500 characters", async () => {
  globalThis.fetch = async (url) => new Response(`bad request ${url} ${TOKEN} ${"x".repeat(2000)}`, { status: 400 });
  for (const [name, res] of await everyLiveTool()) {
    const t = text(res);
    assert.equal(res.isError, true, name);
    assert.ok(!t.includes(TOKEN) && !t.includes(encodeURIComponent(TOKEN)), `${name} leaked the token`);
    assert.match(t, /The Legistar API answered HTTP 400\..*Check the id or file number/);
    assert.match(t, new RegExp(`cut at ${UPSTREAM_BODY_MAX} characters`));
    assert.ok(t.length < 1200, `${name}: ${t.length} characters`);
  }
});

test("a server error says to try again and names the tools that still work", async () => {
  globalThis.fetch = async () => new Response("", { status: 500 });
  const res = await handleLiveTool("get_votes", { event_item_id: 1 }, TOKEN);
  assert.equal(res.isError, true);
  assert.match(text(res), /^Error: The Legistar API answered HTTP 500.*Try again in a minute\..*local-index tools/s);
}, { timeout: 10_000 });

test("a bad argument is a plain sentence, not a JSON dump of schema issues", () => {
  const db = new Database(":memory:");
  db.exec(CREATE_TABLES);
  for (const [limit, why] of [[0, "limit must be 1 or more"], [2.5, "limit must be a whole number"]]) {
    const res = handleLocalTool("search_legislation", { query: "x", limit }, db);
    assert.equal(res.isError, true);
    assert.equal(text(res), `Error: search_legislation got arguments it cannot use (limit: ${why}). Check the arguments and try again.`);
  }
});

test("no answer carries a stack trace", async () => {
  globalThis.fetch = async () => { const e = new Error("boom"); e.message = `boom\n    at fetch (node:internal/x:1:1)`; throw e; };
  const res = await handleLiveTool("get_committee", { name: "x" }, TOKEN);
  assert.ok(!/^\s*at /m.test(text(res)), text(res));
});
