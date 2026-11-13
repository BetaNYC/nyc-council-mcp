// "Where does this data come from?" (#48). Noel, 2026-11-12: a user should be
// able to ask the server where its data comes from, who made it and how it was
// built, and get a straight answer for the specific data they mean. The
// about_data tool answers in every mode (no token, no index needed), names the
// source of every tool, says which facts are official and which are BetaNYC's
// curation, and reports how current each source is on this server.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { ABOUT_TOOL_DEF, ABOUT_TOPICS, handleAbout, SERVER_INSTRUCTIONS } from "../dist/about.js";
import { LOCAL_TOOL_DEFS } from "../dist/tools/local.js";
import { LIVE_TOOL_DEFS, LIVE_SEARCH_TOOL_DEF } from "../dist/tools/live.js";
import { CREATE_TABLES } from "../dist/db/schema.js";

const ask = (args, ctx = { db: null, hasLive: false }) => {
  const res = handleAbout(args, ctx);
  return { res, body: res.isError ? null : JSON.parse(res.content[0].text) };
};

function indexDb() {
  const db = new Database(":memory:");
  db.exec(CREATE_TABLES);
  const put = db.prepare("INSERT OR REPLACE INTO index_state (key, value) VALUES (?, ?)");
  put.run("last_indexed_at", "2026-11-12T11:30:07.125Z");
  put.run("archive_commit", "9e52935");
  put.run("archive_commit_date", "2026-11-11T23:38:10Z");
  put.run("member_terms_fetched_at", "2026-11-13T02:13:52Z");
  return db;
}

test("says who made it, how to reach them, and the license", () => {
  const { body } = ask({});
  assert.match(body.made_by, /BetaNYC, a project of the Fund for the City of New York/);
  assert.match(body.repository, /github\.com\/BetaNYC\/nyc-council-mcp/);
  assert.match(body.questions_or_corrections, /issues/);
  assert.equal(body.license, "MIT");
  assert.ok(body.how_it_works.length > 0);
});

test("every tool's data source is documented, so a new tool cannot ship unexplained", () => {
  const { body } = ask({});
  const covered = new Set(body.sources.flatMap((s) => s.tools));
  for (const t of [...LOCAL_TOOL_DEFS, ...LIVE_TOOL_DEFS, LIVE_SEARCH_TOOL_DEF]) {
    assert.ok(covered.has(t.name), `about_data does not say where ${t.name} gets its data`);
  }
  for (const s of body.sources) {
    assert.ok(s.source && s.source_url && typeof s.official === "boolean", s.topic);
  }
});

test("party: curated by BetaNYC from Board of Elections results, not official", () => {
  const { body } = ask({ topic: "party" });
  assert.equal(body.sources.length, 1);
  const [s] = body.sources;
  assert.equal(s.official, false);
  assert.match(s.source, /Board of Elections/);
  assert.match(s.how, /every ballot line/);
  assert.match(s.as_of, /^\d{4}-\d{2}-\d{2}/);
});

test("districts: the City's dataset, with this server's snapshot date", () => {
  const { body } = ask({ topic: "districts" }, { db: indexDb(), hasLive: false });
  const [s] = body.sources;
  assert.equal(s.official, true);
  assert.match(s.source_url, /uvw5-9znb/);
  assert.equal(s.as_of, "2026-11-13T02:13:52Z");
});

test("the local index reports its build time and archive commit", () => {
  const { body } = ask({ topic: "bills" }, { db: indexDb(), hasLive: true });
  const local = body.sources.find((s) => s.topic === "bills");
  assert.match(local.as_of, /2026-11-12T11:30:07/);
  assert.match(local.as_of, /9e52935/);
  assert.equal(body.this_server.local_index, true);
  assert.equal(body.this_server.live_api, true);
});

test("no index on this server: local sources say so instead of a date", () => {
  const { body } = ask({ topic: "bills" });
  const local = body.sources.find((s) => s.topic === "bills");
  assert.match(local.as_of, /no local index on this server/);
});

test("an unknown topic is an error that lists the topics", () => {
  const { res } = ask({ topic: "weather" });
  assert.ok(res.isError);
  assert.match(res.content[0].text, /districts/);
  assert.deepEqual(ABOUT_TOOL_DEF.inputSchema.properties.topic.enum, ABOUT_TOPICS);
});

test("the server tells the model to use about_data when asked about sources", () => {
  assert.match(SERVER_INSTRUCTIONS, /about_data/);
  assert.match(SERVER_INSTRUCTIONS, /where.*data comes from|source/i);
  assert.match(ABOUT_TOOL_DEF.description, /where/i);
});
