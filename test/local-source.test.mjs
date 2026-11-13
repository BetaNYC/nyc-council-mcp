// Where a local answer came from (#25), and live status for upcoming meetings (#42).
//
// #25: local answers carried no build date; one tool had a hard-coded "1–7 days
// stale" guess. Every local answer now gets a second content line saying when
// the index was built and from which archive commit (index_state), and, with
// no token, that it was not checked live.
//
// #42: the archive said "Final" for event 22725 while Legistar said "Deferred",
// with the SAME EventLastModifiedUtc (2026-09-10T15:35:07). Legistar changed
// the status without bumping the timestamp, so the archive never re-fetched it.
// Checked 2026-11-12: 10 of 658 2026 meetings differ this way (all Final →
// Deferred), one of them upcoming; 16 upcoming meetings were not in the index
// yet. With a token, upcoming_events now takes status from the live API.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { sourceNote, withSourceNote, overlayLiveEventStatus } from "../dist/tools/local-source.js";
import { LOCAL_TOOL_DEFS } from "../dist/tools/local.js";
import { buildIndex } from "../dist/db/indexer.js";
import { CREATE_TABLES } from "../dist/db/schema.js";

function stateDb(state) {
  const db = new Database(":memory:");
  db.exec(CREATE_TABLES);
  const put = db.prepare("INSERT OR REPLACE INTO index_state (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(state)) put.run(k, v);
  return db;
}

const BUILT = {
  last_indexed_at: "2026-11-12T11:30:07.125Z",
  archive_commit: "9e52935",
  archive_commit_date: "2026-11-11T23:38:10Z",
};

test("sourceNote names the build time and archive commit", () => {
  const note = sourceNote(stateDb(BUILT), { hasLive: true, empty: false });
  assert.match(note, /local index built 2026-11-12T11:30:07\.125Z/);
  assert.match(note, /jehiah\/nyc_legislation@9e52935/);
  assert.match(note, /2026-11-11T23:38:10Z/);
  assert.doesNotMatch(note, /LEGISTAR_TOKEN/);
});

test("sourceNote in local-only mode says it was not checked live", () => {
  const note = sourceNote(stateDb(BUILT), { hasLive: false, empty: false });
  assert.match(note, /not checked against the live Legistar API/);
  assert.match(note, /LEGISTAR_TOKEN/);
});

test("an empty local-only answer says 'not in this index', not 'does not exist'", () => {
  const note = sourceNote(stateDb(BUILT), { hasLive: false, empty: true });
  assert.match(note, /not in this index/);
});

test("an index with no recorded build time says so", () => {
  assert.match(sourceNote(stateDb({}), { hasLive: true, empty: false }), /build time unknown/);
});

test("withSourceNote adds a second content item and leaves the JSON alone", () => {
  const res = { content: [{ type: "text", text: "[1,2]" }] };
  const out = withSourceNote(res, stateDb(BUILT), { hasLive: true });
  assert.equal(out.content.length, 2);
  assert.equal(out.content[0].text, "[1,2]");
  assert.match(out.content[1].text, /local index built/);
});

test("withSourceNote leaves errors alone", () => {
  const res = { content: [{ type: "text", text: "Error: x" }], isError: true };
  assert.equal(withSourceNote(res, stateDb(BUILT), { hasLive: true }).content.length, 1);
});

test("withSourceNote treats '[]' as empty", () => {
  const out = withSourceNote({ content: [{ type: "text", text: "[]" }] }, stateDb(BUILT), { hasLive: false });
  assert.match(out.content[1].text, /not in this index/);
});

test("the hard-coded '1–7 days' guess is gone", () => {
  for (const t of LOCAL_TOOL_DEFS) assert.doesNotMatch(t.description, /1–7 days/, t.name);
});

test("overlayLiveEventStatus takes the live status and flags a difference", () => {
  const rows = [
    { event_id: 22725, date: "2026-10-14", agenda_status: "Final" },
    { event_id: 22766, date: "2026-10-19", agenda_status: "Final" },
    { event_id: 22999, date: "2026-10-20", agenda_status: "Final" },
  ];
  const live = [
    { EventId: 22725, EventDate: "2026-10-14T00:00:00", EventAgendaStatusName: "Deferred", EventBodyName: "Committee on Health" },
    { EventId: 22766, EventDate: "2026-10-19T00:00:00", EventAgendaStatusName: "Final", EventBodyName: "Committee on Health" },
    { EventId: 22900, EventDate: "2026-10-21T00:00:00", EventAgendaStatusName: "Final", EventBodyName: "Committee on Finance" },
  ];
  const { rows: out, missing } = overlayLiveEventStatus(rows, live);
  assert.deepEqual(out[0], {
    event_id: 22725, date: "2026-10-14", agenda_status: "Deferred",
    agenda_status_index: "Final", status_checked_live: true,
  });
  assert.deepEqual(out[1], { event_id: 22766, date: "2026-10-19", agenda_status: "Final", status_checked_live: true });
  // Not in the live window answer: left as the index has it, marked unchecked.
  assert.equal(out[2].status_checked_live, false);
  assert.deepEqual(missing.map((e) => e.EventId), [22900]);
});

test("the indexer records the archive commit when the archive is a git repo", async () => {
  const root = mkdtempSync(join(tmpdir(), "legistar-src-"));
  mkdirSync(join(root, "introduction", "2026"), { recursive: true });
  writeFileSync(
    join(root, "introduction", "2026", "0001.json"),
    JSON.stringify({ ID: 1, File: "Int 0001-2026", Name: "x", Title: "x", TypeName: "Introduction" })
  );
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { stdio: "pipe" }).toString().trim();
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x");
  const sha = git("rev-parse", "--short", "HEAD");
  const dbPath = join(root, "t.db");
  await buildIndex({ archiveRoot: root, dbPath, full: true });
  const db = new Database(dbPath, { readonly: true });
  const state = Object.fromEntries(db.prepare("SELECT key, value FROM index_state").all().map((r) => [r.key, r.value]));
  db.close();
  assert.equal(state.archive_commit, sha);
  assert.match(state.archive_commit_date, /^\d{4}-\d{2}-\d{2}T/);
});

test("checkUpcomingLive rewrites the JSON and notes meetings the index lacks", async () => {
  const { checkUpcomingLive } = await import("../dist/tools/local-source.js");
  const res = { content: [{ type: "text", text: JSON.stringify([{ event_id: 22843, date: "2026-11-23", agenda_status: "Final" }]) }] };
  const calls = [];
  const out = await checkUpcomingLive(res, 14, async (from, to) => {
    calls.push([from, to]);
    return [
      { EventId: 22843, EventDate: "2026-11-23T00:00:00", EventAgendaStatusName: "Deferred", EventBodyName: "X" },
      { EventId: 22901, EventDate: "2026-11-24T00:00:00", EventAgendaStatusName: "Final", EventBodyName: "Committee on Y" },
    ];
  });
  const rows = JSON.parse(out.content[0].text);
  assert.equal(rows[0].agenda_status, "Deferred");
  assert.equal(rows[0].agenda_status_index, "Final");
  assert.match(out.content[1].text, /1 upcoming meeting .*not in the local index yet.*22901/);
  assert.match(calls[0][0], /^\d{4}-\d{2}-\d{2}$/);
});

test("checkUpcomingLive keeps the local answer if the live call fails", async () => {
  const { checkUpcomingLive } = await import("../dist/tools/local-source.js");
  const text = JSON.stringify([{ event_id: 1, date: "2026-11-23", agenda_status: "Final" }]);
  const out = await checkUpcomingLive({ content: [{ type: "text", text }] }, 14, async () => {
    throw new Error("Legistar API error 503");
  });
  assert.equal(out.content[0].text, text);
  assert.match(out.content[1].text, /could not be checked against the live API/);
});
