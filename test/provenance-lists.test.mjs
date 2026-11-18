// Every data answer names its source with a link (#84) and says how current it is (#85), and
// every list says when more results exist and how to get them (#86). Offline: fetch is mocked
// for the live tools; the local tools run through the built server over stdio against a
// fixture index, the way an AI app calls them.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { handleLiveTool, handleLiveSearch, LIVE_TOOL_DEFS, LIVE_SEARCH_TOOL_DEF } from "../dist/tools/live.js";
import { handleLocalTool, LOCAL_TOOL_DEFS, LIST_LIMITS } from "../dist/tools/local.js";
import { SOURCE_LINK } from "../dist/tools/source-links.js";
import { CREATE_TABLES } from "../dist/db/schema.js";
import { nyDateString } from "../dist/dates.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const last = (res) => res.content.at(-1).text;

test("every tool has a link a person can open", () => {
  for (const t of [...LOCAL_TOOL_DEFS, ...LIVE_TOOL_DEFS, LIVE_SEARCH_TOOL_DEF]) {
    assert.match(SOURCE_LINK[t.name] ?? "", /^https:\/\//, t.name);
  }
});

// ------------------------------------------------------------------ live

const LIVE_ARGS = {
  get_bill: { file_number: "Int 0001-2024" }, get_bill_history: { matter_id: 1 }, get_bill_attachments: { matter_id: 1 },
  get_upcoming_hearings: { include_agenda: false }, get_council_member: { name: "Brewer" }, get_committee: { name: "Health" },
  get_votes: { event_item_id: 1 }, list_recent_legislation: {},
};

test("every live answer ends with its source, a link and the time it was fetched", async () => {
  globalThis.fetch = async () => new Response("[]", { status: 200 });
  const answers = [];
  for (const t of LIVE_TOOL_DEFS) answers.push([t.name, await handleLiveTool(t.name, LIVE_ARGS[t.name], "tok")]);
  answers.push(["search_legislation_live", await handleLiveSearch({ query: "x" }, "tok")]);
  for (const [name, res] of answers) {
    assert.ok(!res.isError, name);
    assert.match(
      last(res),
      /^Source: NYC Council Legistar Web API \(Granicus\)\. As of \d{4}-\d{2}-\d{2}T[\d:.]+Z \(fetched from the source for this answer\)\. Link: https:\/\/legistar\.council\.nyc\.gov\/\S+$/,
      name
    );
    assert.ok(last(res).endsWith(SOURCE_LINK[name]), name);
  }
});

test("a live list cut at its limit says more are available", async () => {
  const urls = [];
  const rows = Array.from({ length: 30 }, (_, i) => ({ MatterId: i + 1, MatterFile: `Int ${i}` }));
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const top = Number(new URL(url).searchParams.get("$top"));
    return new Response(JSON.stringify(rows.slice(0, top)), { status: 200 });
  };
  const res = await handleLiveTool("list_recent_legislation", { limit: 25 }, "tok");
  assert.equal(new URL(urls[0]).searchParams.get("$top"), "26", "asks for one more than the limit");
  assert.equal(JSON.parse(res.content[0].text).length, 25);
  assert.match(res.content[1].text, /^Showing the first 25 results; more are available\. Raise limit \(up to 50\)/);
  const all = await handleLiveTool("list_recent_legislation", { limit: 50 }, "tok");
  assert.equal(JSON.parse(all.content[0].text).length, 30);
  assert.equal(all.content.length, 2, "no 'more' note when everything fit; only the source line");
  const search = await handleLiveSearch({ query: "x", limit: 5 }, "tok");
  assert.match(search.content[1].text, /Showing the first 5 results; more are available/);
  const big = await handleLiveTool("list_recent_legislation", { limit: 51 }, "tok");
  assert.equal(big.isError, true, "over the hard maximum");
});

// ------------------------------------------------------------------ local lists

function bigDb(n) {
  const db = new Database(":memory:");
  db.exec(CREATE_TABLES);
  const today = nyDateString();
  const bill = db.prepare("INSERT INTO bills (matter_id, file_number, title, intro_date, source_json) VALUES (?,?,?,?,?)");
  const ev = db.prepare("INSERT INTO events (event_id, date, body_name, source_json) VALUES (?,?,?,?)");
  db.prepare("INSERT INTO people (person_id, full_name) VALUES (1, 'Pat Member')").run();
  const sp = db.prepare("INSERT INTO sponsors (matter_id, person_id) VALUES (?,?)");
  const vote = db.prepare("INSERT INTO votes (event_item_id, person_id, person_name, vote_value, matter_id) VALUES (?,?,?,?,?)");
  for (let i = 1; i <= n; i++) {
    bill.run(i, `Int ${String(i).padStart(4, "0")}-2026`, `A Local Law about bicycles ${i}`, today, "{}");
    ev.run(i, today, "Committee on Transportation", "{}");
    db.prepare("INSERT OR IGNORE INTO people (person_id, full_name) VALUES (?, ?)").run(i + 1, `Other Member ${i}`);
    sp.run(i, 1);
    sp.run(i, i + 1);
    vote.run(i, 1, "Pat Member", "Affirmative", i);
  }
  return db;
}

const LIST_ARGS = {
  search_legislation: { query: "bicycles" }, search_bills: { query: "bicycles" }, search_events: { query: "transportation" },
  recent_bills: {}, upcoming_events: {}, get_voting_record: { member_name: "Pat Member" }, co_sponsors: { member_name: "Pat Member" },
};

test("every local list tool stops at its default and says more are available, with a large fixture", () => {
  const db = bigDb(250);
  for (const [tool, args] of Object.entries(LIST_ARGS)) {
    const { default: def, max } = LIST_LIMITS[tool];
    const res = handleLocalTool(tool, args, db);
    assert.ok(!res.isError, `${tool}: ${res.content[0].text}`);
    assert.equal(JSON.parse(res.content[0].text).length, def, tool);
    assert.match(res.content[1].text, new RegExp(`^Showing the first ${def} results; more are available\\. Raise limit \\(up to ${max}\\)`), tool);
  }
});

test("every local list tool has a hard maximum", () => {
  const db = bigDb(1);
  for (const [tool, args] of Object.entries(LIST_ARGS)) {
    const res = handleLocalTool(tool, { ...args, limit: LIST_LIMITS[tool].max + 1 }, db);
    assert.equal(res.isError, true, tool);
    const ok = handleLocalTool(tool, { ...args, limit: LIST_LIMITS[tool].max }, db);
    assert.ok(!ok.isError, tool);
    assert.equal(ok.content.length, 1, `${tool}: everything fit, so no 'more' note`);
  }
});

// ------------------------------------------------------------------ local answers, over stdio

const LOCAL_ARGS = {
  search_legislation: { query: "bicycles" }, search_bills: { query: "bicycles" }, get_matter: { file_number: "Int 0001-2026" },
  get_member_roles: { member_name: "Pat Member" }, committee_roster: { committee: "Transportation" }, district_member: { district: 1 },
  search_events: { query: "transportation" }, list_committees: {}, recent_bills: {}, upcoming_events: {},
  aggregate_bills: { group_by: "status" }, vote_breakdown: { file_number: "Int 0001-2026" },
  get_voting_record: { member_name: "Pat Member" }, get_bill_history: { file_number: "Int 0001-2026" },
  co_sponsors: { member_name: "Pat Member" }, get_bill_hearings: { file_number: "Int 0001-2026" }, get_event_bills: { event_id: 1 },
};

test("every local answer ends with its source, the index date and a link (over MCP stdio)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "council-prov-"));
  const dbPath = join(dir, "legistar.db");
  const db = bigDb(3);
  await db.backup(dbPath);
  db.close();
  const file = new Database(dbPath);
  const put = file.prepare("INSERT OR REPLACE INTO index_state (key, value) VALUES (?, ?)");
  put.run("last_indexed_at", "2026-11-12T11:30:07.125Z");
  put.run("archive_commit", "9e52935");
  put.run("member_terms_fetched_at", "2026-11-13T02:13:52Z");
  file.close();
  const env = { ...process.env, LEGISTAR_DB_PATH: dbPath };
  delete env.LEGISTAR_TOKEN;
  const client = new Client({ name: "provenance-test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "dist/index.js")], env, stderr: "ignore" }));
  try {
    let answered = 0;
    for (const t of LOCAL_TOOL_DEFS) {
      const res = await client.callTool({ name: t.name, arguments: LOCAL_ARGS[t.name] });
      if (res.isError) continue; // an error is not a data answer
      answered++;
      assert.match(last(res), /^Source: local index built 2026-11-12T11:30:07\.125Z from jehiah\/nyc_legislation@9e52935/, t.name);
      assert.ok(last(res).endsWith(`Link: ${SOURCE_LINK[t.name]}`), `${t.name}: ${last(res)}`);
      if (t.name === "district_member") assert.match(last(res), /council terms from NYC Open Data uvw5-9znb, fetched 2026-11-13T02:13:52Z/);
    }
    assert.ok(answered >= 14, `only ${answered} local tools answered; the check would be too weak`);
  } finally {
    await client.close();
  }
});
