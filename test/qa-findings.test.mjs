// Findings from the full pre-release run on home-hearth (2026-11-13, #48).
// Each test is the scenario that run found: an answer that was empty or
// misleading without saying why.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { CREATE_TABLES } from "../dist/db/schema.js";
import { withMemberTerms } from "../dist/tools/member-terms.js";
import { handleLiveTool } from "../dist/tools/live.js";

function termsDb() {
  const db = new Database(":memory:");
  db.exec(CREATE_TABLES);
  db.prepare(
    "INSERT INTO member_terms (office_id, person_id, name, district, term_start, term_end) VALUES (5805, 5259, 'Gale A. Brewer', 6, '2026-01-01', '2029-12-31')"
  ).run();
  const put = db.prepare("INSERT OR REPLACE INTO index_state (key, value) VALUES (?, ?)");
  put.run("member_terms_fetched_at", "2026-11-13T02:13:52Z");
  put.run("member_terms_rows_updated_at", "2026-04-10T18:00:29Z");
  return db;
}

const people = (list) => ({ content: [{ type: "text", text: JSON.stringify(list) }] });

test("a member the City's terms file does not list gets a note, not a bare empty list", () => {
  // Carl Wilson (7874) took District 3 on 2026-05-13; the City's file was last updated 2026-04-10.
  const out = JSON.parse(withMemberTerms(people([{ PersonId: 7874 }]), termsDb(), "2026-11-13").content[0].text);
  assert.equal(out[0].district, null);
  assert.deepEqual(out[0].terms, []);
  assert.match(out[0].terms_note, /does not list/);
  assert.match(out[0].terms_note, /2026-04-10/);
  assert.match(out[0].terms_note, /district_member/);
});

test("a member the file does list gets no note", () => {
  const out = JSON.parse(withMemberTerms(people([{ PersonId: 5259 }]), termsDb(), "2026-11-13").content[0].text);
  assert.equal(out[0].district, 6);
  assert.equal(out[0].terms_note, undefined);
});

test("get_council_member with no match says former members are not searched", async () => {
  const saved = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => [{ PersonId: 5259, PersonFullName: "Gale A. Brewer", PersonActiveFlag: 1 }] });
  try {
    const res = await handleLiveTool("get_council_member", { name: "Corey Johnson" }, "t");
    assert.ok(!res.isError);
    assert.deepEqual(JSON.parse(res.content[0].text), [], "the result stays a JSON list");
    assert.match(res.content[1].text, /No active/);
    assert.match(res.content[1].text, /former members/i);
    const hit = await handleLiveTool("get_council_member", { name: "Gale Brewer" }, "t");
    assert.equal(hit.content.length, 1, "no note when someone matches");
  } finally {
    global.fetch = saved;
  }
});

test("a database path that does not exist is named at startup, not 'no data source configured'", () => {
  const missing = join(tmpdir(), "nyc-council-mcp-no-such-dir", "legistar.db");
  const env = { ...process.env, LEGISTAR_DB_PATH: missing };
  delete env.LEGISTAR_TOKEN;
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("../dist/index.js", import.meta.url))], { env, input: "", encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not found/);
  assert.ok(r.stderr.includes(missing), "names the path it looked at");
});

test("the index summary can report what is stored, not only what was read", async () => {
  // The archive can hold one matter in two files; it is read twice and stored once.
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { buildIndex, indexTotals } = await import("../dist/db/indexer.js");
  const root = mkdtempSync(join(tmpdir(), "legistar-totals-"));
  mkdirSync(join(root, "resolution", "2026"), { recursive: true });
  const matter = { ID: 79300, File: "Res 0704-2026", Title: "x", TypeName: "Resolution", History: [] };
  writeFileSync(join(root, "resolution", "2026", "0704.json"), JSON.stringify(matter));
  writeFileSync(join(root, "resolution", "2026", "0704-copy.json"), JSON.stringify(matter));
  const dbPath = join(root, "t.db");
  const stats = await buildIndex({ archiveRoot: root, dbPath, full: true, termsPath: join(root, "none.json") });
  assert.equal(stats.bills, 2, "two files read");
  assert.equal(indexTotals(dbPath).bills, 1, "one matter stored");
});
