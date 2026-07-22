// Unknown tool parameters must be rejected, not silently dropped.
//
// Bug guarded against (issue #20): zod strips unknown keys by default and the
// advertised inputSchemas did not set additionalProperties:false, so
//   search_legislation(query="broadband", bogus_unknown_param="x", limit=1)
// returned a normal, correctly-sourced result row for a *different* question.
// Nothing in the response signalled that a filter had been dropped.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { LOCAL_TOOL_DEFS, handleLocalTool } from "../dist/tools/local.js";
import { LIVE_TOOL_DEFS, LIVE_SEARCH_TOOL_DEF, handleLiveTool } from "../dist/tools/live.js";
import { CREATE_TABLES } from "../dist/db/schema.js";

const ALL_TOOL_DEFS = [...LOCAL_TOOL_DEFS, ...LIVE_TOOL_DEFS, LIVE_SEARCH_TOOL_DEF];

function emptyDb() {
  const db = new Database(":memory:");
  db.exec(CREATE_TABLES);
  return db;
}

test("every advertised tool schema sets additionalProperties:false", () => {
  assert.ok(ALL_TOOL_DEFS.length > 0, "tool definitions must be exported for this test");
  for (const tool of ALL_TOOL_DEFS) {
    assert.equal(
      tool.inputSchema.additionalProperties,
      false,
      `${tool.name} must set additionalProperties:false so unknown params are rejected`
    );
  }
});

test("a local tool refuses an unknown parameter instead of answering", () => {
  // The exact reproduction from issue #20.
  const res = handleLocalTool(
    "search_legislation",
    { query: "broadband", bogus_unknown_param: "SHOULD_REJECT", limit: 1 },
    emptyDb()
  );
  assert.equal(res.isError, true, "an undeclared parameter must surface as an error");
  assert.match(res.content[0].text, /unrecognized|unknown|not permitted/i);
});

test("the refusal names the accepted parameters for that tool", () => {
  const res = handleLocalTool(
    "search_legislation",
    { query: "broadband", council_district: 10 },
    emptyDb()
  );
  assert.match(res.content[0].text, /council_district/, "names the offending key");
  for (const accepted of ["query", "limit", "agency", "status", "committee"]) {
    assert.match(res.content[0].text, new RegExp(`\\b${accepted}\\b`), `names '${accepted}'`);
  }
});

test("a live tool refuses an unknown parameter before it reaches the network", async () => {
  // zod parsing happens before any fetch, so this makes no live API call.
  const res = await handleLiveTool(
    "get_bill",
    { file_number: "Int 0349-2024", bogus_unknown_param: "x" },
    "not-a-real-token"
  );
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /unrecognized|unknown|not permitted/i);
});

test("regression: the same call without the bogus key still works", () => {
  const res = handleLocalTool("search_legislation", { query: "broadband", limit: 1 }, emptyDb());
  assert.notEqual(res.isError, true, `expected success, got: ${res.content[0].text}`);
  assert.deepEqual(JSON.parse(res.content[0].text), [], "empty index returns an empty result set");
});

test("regression: a no-parameter tool still works when called with no parameters", () => {
  const res = handleLocalTool("list_committees", {}, emptyDb());
  assert.notEqual(res.isError, true, `expected success, got: ${res.content[0].text}`);
});
