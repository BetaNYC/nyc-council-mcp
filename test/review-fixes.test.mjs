// Fixes from the independent review of the 2.8.0 stack (2026-11-12, #48).
// Each test is the reviewer's failing scenario. District-seat cases live in
// member-terms.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { CREATE_TABLES } from "../dist/db/schema.js";
import { memberRoles, committeeRoster, getVotingRecord, normalizeLocalLaw } from "../dist/db/queries.js";
import { checkUpcomingLive } from "../dist/tools/local-source.js";
import { buildIndex } from "../dist/db/indexer.js";
import { curatedFor, loadCurated } from "../dist/curated.js";

test("#2: roles on an index without membership data is an error, not 'sits on nothing'", () => {
  const db = new Database(":memory:");
  db.exec(CREATE_TABLES);
  db.prepare("INSERT INTO people (person_id, full_name, active_flag) VALUES (5259, 'Gale A. Brewer', 1)").run();
  assert.throws(() => memberRoles(db, "Gale Brewer"), /Re-run the indexer/);
  assert.throws(() => committeeRoster(db, "technology"), /Re-run the indexer/);
});

test("#3: meetings cut off by limit are not reported as missing from the index", async () => {
  const res = { content: [{ type: "text", text: JSON.stringify([{ event_id: 1, date: "2026-11-20", agenda_status: "Final" }]) }] };
  const live = [
    { EventId: 1, EventDate: "2026-11-20T00:00:00", EventAgendaStatusName: "Final", EventBodyName: "A" },
    { EventId: 2, EventDate: "2026-11-21T00:00:00", EventAgendaStatusName: "Final", EventBodyName: "B" }, // in index, past limit
    { EventId: 3, EventDate: "2026-11-22T00:00:00", EventAgendaStatusName: "Final", EventBodyName: "C" }, // truly missing
  ];
  const out = await checkUpcomingLive(res, 14, async () => live, (ids) => new Set(ids.filter((id) => id === 2)));
  assert.match(out.content[1].text, /^1 upcoming meeting is/);
  assert.match(out.content[1].text, /\b3 \(/);
  assert.doesNotMatch(out.content[1].text, /\b2 \(/);
});

test("#4: Local Law numbers are found however they are written", () => {
  assert.equal(normalizeLocalLaw("2009/1"), "2009/001");
  assert.equal(normalizeLocalLaw("2009/001"), "2009/001");
  assert.equal(normalizeLocalLaw("Local Law 1 of 2009"), "2009/001");
  assert.equal(normalizeLocalLaw("LL 153/2025"), "2025/153");
  assert.equal(normalizeLocalLaw("1/2009"), "2009/001");
  assert.equal(normalizeLocalLaw("not a law"), null);
});

test("#5: the curated block carries each fact's status and second check", () => {
  const c = curatedFor(7874, loadCurated());
  assert.equal(c.party.status, "likely");
  assert.equal(c.party.certified, false);
  assert.ok(c.party.second_check);
  assert.equal(c.wikidata.status, "verified");
  const brewer = curatedFor(5259, loadCurated());
  assert.equal(brewer.party.status, "verified");
  for (const f of ["council-wikidata.json", "council-party.json", "council-social.json"]) {
    const d = JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url)));
    assert.ok(d.rows.every((r) => !("reviewed_by" in r)), `${f}: reviewed_by is replaced by second_check`);
  }
});

test("#6: voting-record rows name the member, so a shared surname is visible", () => {
  const db = new Database(":memory:");
  db.exec(CREATE_TABLES);
  db.prepare("INSERT INTO bills (matter_id, file_number, title, intro_date, source_json) VALUES (1,'Res 0001-2026','x','2026-01-01','{}')").run();
  const v = db.prepare("INSERT INTO votes (event_item_id, person_id, person_name, vote_value, matter_id) VALUES (?,?,?,?,1)");
  v.run(10, 7780, "Jumaane D. Williams", "Affirmative");
  v.run(10, 7811, "Nantasha M. Williams", "Negative");
  const rows = getVotingRecord(db, "Williams");
  assert.deepEqual(rows.map((r) => r.person_name).sort(), ["Jumaane D. Williams", "Nantasha M. Williams"]);
});

test("#8: vote times are New York local time, not labeled UTC", async () => {
  const root = mkdtempSync(join(tmpdir(), "legistar-tz-"));
  mkdirSync(join(root, "resolution", "2026"), { recursive: true });
  writeFileSync(join(root, "resolution", "2026", "0704.json"), JSON.stringify({
    ID: 79300, File: "Res 0704-2026", Title: "x", TypeName: "Resolution",
    History: [{ ID: 500, Date: "2026-10-22T13:30:00Z", Action: "Adopted", BodyName: "City Council" }],
  }));
  const dbPath = join(root, "t.db");
  await buildIndex({ archiveRoot: root, dbPath, full: true, termsPath: join(root, "none.json") });
  const db = new Database(dbPath, { readonly: true });
  assert.equal(db.prepare("SELECT action_date FROM matter_history").get().action_date, "2026-10-22T13:30:00");
  db.close();
});

test("#10: every shipped data file is covered by CI and the version guard", () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /- "data\/\*\*"/);
  assert.match(ci, /-- src package\.json data\b/);
});

test("#9: the refresh workflow starts CI on its own PR and never reuses a branch name", () => {
  const wf = readFileSync(new URL("../.github/workflows/refresh-member-terms.yml", import.meta.url), "utf8");
  assert.match(wf, /gh workflow run ci\.yml/);
  assert.match(wf, /actions: write/);
  assert.match(wf, /github\.run_id/);
});
