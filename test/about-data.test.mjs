// "Where does this data come from?" (#48). Noel, 2026-11-12: a user should be able to ask the
// server where its data comes from, who made it and how it was built, and get a straight answer
// for the specific data they mean. Since 2.8.0 the answer comes from DATA-SOURCES.json through
// BetaNYC's shared about_data module (src/betanyc-tools.ts, a copy: never edit it here).
// These tests keep what #67 promised: every tool has a documented source, official and curated
// facts are told apart, and how current each source is comes from real build artifacts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { createAboutData, SERVER_INSTRUCTIONS, WHO_BUILT_THIS } from "../dist/betanyc.js";
import { assertEveryToolExplained } from "../dist/betanyc-tools.js";
import { LOCAL_TOOL_DEFS } from "../dist/tools/local.js";
import { LIVE_TOOL_DEFS, LIVE_SEARCH_TOOL_DEF } from "../dist/tools/live.js";
import { CREATE_TABLES } from "../dist/db/schema.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DS_TEXT = readFileSync(join(ROOT, "DATA-SOURCES.json"), "utf8");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const ALL_TOOLS = [...new Set([...LOCAL_TOOL_DEFS, ...LIVE_TOOL_DEFS, LIVE_SEARCH_TOOL_DEF, { name: "about_data" }].map((t) => t.name))];

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

const ask = (args, db = null, hasLive = false) => {
  const res = createAboutData({ db, hasLive, version: VERSION }).call(args);
  return { res, body: res.structuredContent };
};
const one = (body, topic) => body.sources.find((s) => s.topic === topic);

test("every tool says where its data comes from, so a new tool cannot ship unexplained", () => {
  assertEveryToolExplained(DS_TEXT, ALL_TOOLS);
  // and the check bites: a tool with no source fails
  assert.throws(() => assertEveryToolExplained(DS_TEXT, [...ALL_TOOLS, "brand_new_tool"]), /brand_new_tool/);
});

test("every source names its source, publisher, link and whether it is official", () => {
  const { body } = ask({});
  assert.deepEqual(body.topics, ["live", "bills", "votes", "events", "committees", "districts", "party", "wikidata", "social"]);
  for (const s of body.sources) {
    assert.ok(s.source && s.publisher && s.source_url && typeof s.official === "boolean", s.topic);
  }
});

test("party: curated by BetaNYC from Board of Elections results, not official, dated by its check", () => {
  const { res, body } = ask({ topic: "party" });
  assert.equal(body.sources.length, 1);
  const [s] = body.sources;
  assert.equal(s.official, false);
  assert.equal(s.figures_official, false);
  assert.match(s.source, /Board of Elections/);
  assert.match(s.how_gathered, /every member|Curated by BetaNYC/);
  assert.equal(s.as_of_status, "read");
  const checked = JSON.parse(readFileSync(join(ROOT, "data/council-party.json"), "utf8")).checked_at;
  assert.equal(s.as_of, checked);
  assert.ok(s.caveats.some((c) => /second_check/.test(c)), "row status and second check are summarized");
  assert.match(res.content[0].text, /Not an official record/);
});

test("wikidata and social: curated, not official, dated by their check", () => {
  for (const topic of ["wikidata", "social"]) {
    const s = one(ask({ topic }).body, topic);
    assert.equal(s.official, false, topic);
    assert.equal(s.as_of_status, "read", topic);
    assert.match(s.as_of, /^\d{4}-\d{2}-\d{2}$/, topic);
  }
});

test("districts: the City's dataset, with this server's snapshot date", () => {
  const { body } = ask({ topic: "districts" }, indexDb());
  const [s] = body.sources;
  assert.equal(s.official, true);
  assert.match(s.source_url, /uvw5-9znb/);
  assert.equal(s.as_of, "2026-11-13T02:13:52Z");
});

test("districts with no index: the shipped snapshot's fetch time", () => {
  const s = one(ask({ topic: "districts" }).body, "districts");
  const fetched = JSON.parse(readFileSync(join(ROOT, "data/council-member-terms.json"), "utf8")).fetched_at;
  assert.equal(s.as_of, fetched);
});

test("the local index reports its build time, and says where the archive commit is", () => {
  const s = one(ask({ topic: "bills" }, indexDb()).body, "bills");
  assert.equal(s.as_of, "2026-11-12T11:30:07.125Z");
  assert.ok(s.caveats.some((c) => /archive commit/.test(c)));
});

test("no index on this server: local sources say so instead of a date", () => {
  const s = one(ask({ topic: "bills" }).body, "bills");
  assert.equal(s.as_of_status, "unavailable");
  assert.doesNotMatch(s.as_of, /\d{4}-\d{2}-\d{2}/);
});

test("live: fetched when asked, the Council's record passed on unchanged", () => {
  const { body } = ask({ topic: "live" }, indexDb(), true);
  const s = one(body, "live");
  assert.equal(s.as_of_status, "live");
  assert.equal(s.figures_official, true);
  assert.deepEqual(body.this_server, { live_api: true, local_index: true });
});

test("no token: the live source says it is not available here, not 'fetched when you ask'", () => {
  const { res, body } = ask({ topic: "live" }, indexDb(), false);
  const s = one(body, "live");
  assert.equal(s.as_of_status, "unavailable");
  assert.match(s.as_of, /not available on this server/);
  assert.doesNotMatch(res.content[0].text, /fetched from the source when you ask/);
  assert.match(res.content[0].text, /live Legistar API not set up; local index present/);
  assert.deepEqual(body.this_server, { live_api: false, local_index: true });
});

test("the archive sources name the Council as publisher and jehiah/nyc_legislation as the unofficial mirror", () => {
  for (const topic of ["bills", "votes", "events", "committees"]) {
    const s = one(ask({ topic }).body, topic);
    assert.equal(s.publisher, "New York City Council", topic);
    assert.doesNotMatch(s.source_url, /jehiah/, topic);
    assert.match(s.how_gathered, /unofficial mirror/, topic);
  }
  assert.deepEqual(one(ask({ topic: "events" }).body, "events").changed_by_betanyc.steps, ["reshaped"]);
});

test("an unreadable DATA-SOURCES.json: the note does not point at about_betanyc either", () => {
  const res = createAboutData({ db: null, hasLive: false, version: VERSION, dataSourcesText: "{" }).call({});
  const body = res.structuredContent;
  assert.match(body.note, /cannot be read/);
  assert.doesNotMatch(body.note, /about_betanyc/);
  assert.doesNotMatch(res.content[0].text, /about_betanyc/);
});

test("a tool name works as a topic: get_council_member covers live, districts and the curated facts", () => {
  const { body } = ask({ topic: "get_council_member" });
  assert.deepEqual(body.sources.map((s) => s.topic), ["live", "districts", "party", "wikidata", "social"]);
});

test("an unknown topic is an error that lists the topics", () => {
  const { res } = ask({ topic: "weather" });
  assert.ok(res.isError);
  assert.match(res.content[0].text, /districts/);
});

test("nothing points at about_betanyc or whats_changed before 2.9.0 registers them", () => {
  const { res, body } = ask({});
  assert.equal(body.who_built_this, WHO_BUILT_THIS);
  assert.match(WHO_BUILT_THIS, /BetaNYC, a project of the Fund for the City of New York/);
  assert.match(WHO_BUILT_THIS, /github\.com\/BetaNYC\/nyc-council-mcp\/issues/);
  assert.doesNotMatch(res.content[0].text, /about_betanyc|whats_changed/);
  assert.doesNotMatch(SERVER_INSTRUCTIONS, /about_betanyc|whats_changed/);
  assert.match(SERVER_INSTRUCTIONS, /call about_data/);
  assert.match(SERVER_INSTRUCTIONS, /figures_official/);
});

test("the server fails at startup when DATA-SOURCES.json names another repo", () => {
  const other = DS_TEXT.replace('"repository": "https://github.com/BetaNYC/nyc-council-mcp"', '"repository": "https://github.com/BetaNYC/other"');
  assert.throws(() => createAboutData({ db: null, hasLive: false, version: VERSION, dataSourcesText: other }), /repository/);
});

test("the package ships DATA-SOURCES.json and data.json", () => {
  const files = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).files;
  for (const f of ["DATA-SOURCES.json", "data.json", "data/council-party.json", "data/council-wikidata.json", "data/council-social.json", "data/council-member-terms.json"]) {
    assert.ok(files.includes(f), f);
  }
});

// Through the MCP protocol, the way an AI app calls it: the built server over stdio, local-only
// mode (an index file, no token, so no network). The SDK client checks structuredContent
// against about_data's declared outputSchema.
test("about_data over MCP stdio: live, party and districts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "council-about-"));
  const dbPath = join(dir, "legistar.db");
  const db = new Database(dbPath);
  db.exec(CREATE_TABLES);
  db.prepare("INSERT OR REPLACE INTO index_state (key, value) VALUES (?, ?)").run("member_terms_fetched_at", "2026-11-13T02:13:52Z");
  db.close();
  const env = { ...process.env, LEGISTAR_DB_PATH: dbPath };
  delete env.LEGISTAR_TOKEN;
  const client = new Client({ name: "about-data-test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "dist/index.js")], env, stderr: "ignore" }));
  try {
    const listed = (await client.listTools()).tools.find((t) => t.name === "about_data");
    assert.ok(listed, "about_data is listed");
    assert.match(listed.description, /Topics on this server: live, bills/);
    assert.doesNotMatch(JSON.stringify(listed), /about_betanyc|whats_changed/);
    assert.ok(listed.outputSchema.properties.this_server);
    assert.match(client.getInstructions() ?? "", /call about_data/);
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(!names.includes("about_betanyc") && !names.includes("whats_changed"));

    const live = await client.callTool({ name: "about_data", arguments: { topic: "live" } });
    // local-only mode: no token, so live is not available on this server
    assert.equal(live.structuredContent.sources[0].as_of_status, "unavailable");
    assert.deepEqual(live.structuredContent.this_server, { live_api: false, local_index: true });
    assert.match(live.content[0].text, /Official record: yes, passed on as New York City Council publishes it/);

    const party = await client.callTool({ name: "about_data", arguments: { topic: "party" } });
    assert.equal(party.structuredContent.sources[0].official, false);
    assert.match(party.content[0].text, /Not an official record: curated by BetaNYC/);

    const districts = await client.callTool({ name: "about_data", arguments: { topic: "districts" } });
    assert.equal(districts.structuredContent.sources[0].as_of, "2026-11-13T02:13:52Z");
    assert.match(districts.content[0].text, /data\.cityofnewyork\.us\/d\/uvw5-9znb/);
  } finally {
    await client.close();
  }
});
