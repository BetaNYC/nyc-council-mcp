// Vote tools must never answer a vote question with a bare [].
//
// Bug guarded against (issue #19): when the `votes` table is empty,
// getVotingRecord / voteBreakdown returned [] for every member, including
// four-year incumbents. An empty array is indistinguishable from a true
// negative — a caller reads [] from a tool named get_voting_record as "this
// member cast no votes." In a transparency tool that is the worst available
// failure mode.
//
// Post-#30: votes ARE now populated from each matter's History[].Votes, so the
// guard is a safety net for an UNBUILT / stale corpus (schema < 5), not a
// permanent disable. This file covers both halves: the guard still fires on an
// empty table, and the populated path returns grouped roll calls with a
// positions-only tally. (Correcting #19's belief that the archive held only
// attendance — History[] carries Affirmative/Negative/Abstain.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";

import { getVotingRecord, voteBreakdown } from "../dist/db/queries.js";
import { openDatabase } from "../dist/db/indexer.js";
import { CREATE_TABLES } from "../dist/db/schema.js";

const NAMED_ERROR = /not indexed|unavailable|no vote data/i;

function emptyDb() {
  const db = new Database(":memory:");
  db.exec(CREATE_TABLES);
  return db;
}

test("an empty votes table raises a named error rather than returning []", () => {
  const db = emptyDb();
  assert.throws(() => getVotingRecord(db, "De La Rosa"), NAMED_ERROR);
  assert.throws(() => voteBreakdown(db, "Int 0349-2024"), NAMED_ERROR);
});

test("the error names what IS available instead of the missing data", () => {
  const db = emptyDb();
  try {
    getVotingRecord(db, "De La Rosa");
    assert.fail("expected a throw");
  } catch (err) {
    // Honest about provenance post-#30: positions ARE in the archive's History[],
    // so an empty table means the corpus needs a rebuild — and a live fallback exists.
    assert.match(err.message, /rebuild/i, "tells the operator to rebuild the corpus");
    assert.match(err.message, /archive|History/i, "names the archive/History as the source of positions");
    assert.match(err.message, /get_votes|Legistar/i, "names the live fallback for positions");
  }
});

test("a populated votes table works normally — the guard is not a hard disable", () => {
  const db = emptyDb();
  // v5 schema: votes key on (event_item_id, person_id) and carry matter_id.
  // vote_breakdown joins bills on matter_id (NOT event_items on file_number),
  // and matter_history supplies the roll call's body/action/date.
  db.prepare(
    `INSERT INTO bills (matter_id, file_number, title, source_json)
     VALUES (55, 'Int 0349-2024', 'A Local Law', '{}')`
  ).run();
  db.prepare(
    `INSERT INTO matter_history (matter_id, event_item_id, action_name, action_date, body_name)
     VALUES (55, 100, 'Approved by Council', '2024-06-01T17:00:00Z', 'City Council')`
  ).run();
  db.prepare(
    `INSERT INTO votes (event_item_id, person_id, person_name, vote_value, matter_id)
     VALUES (100, 7, 'Carmen De La Rosa', 'Affirmative', 55)`
  ).run();

  const rows = getVotingRecord(db, "De La Rosa");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].file_number, "Int 0349-2024");

  const breakdown = voteBreakdown(db, "Int 0349-2024");
  assert.equal(breakdown.roll_calls.length, 1, "one roll call for this matter");
  assert.equal(breakdown.roll_calls[0].votes.length, 1);
  assert.equal(breakdown.roll_calls[0].body_name, "City Council");
  assert.equal(breakdown.roll_calls[0].tally.affirmative, 1);
});

// The acceptance test from issue #19, against the real corpus. Skips cleanly
// when the database is absent — it will be, in CI and on other machines.
const dbPath = process.env.LEGISTAR_DB_PATH;
test("real corpus: vote tools do not answer with an empty array when the table is unpopulated", {
  skip: !dbPath || !existsSync(dbPath) ? "LEGISTAR_DB_PATH not set or file missing" : false,
}, () => {
  const db = openDatabase(dbPath);
  const voteCount = db.prepare("SELECT COUNT(*) AS n FROM votes").get().n;
  if (voteCount === 0) {
    assert.throws(
      () => getVotingRecord(db, "De La Rosa"),
      NAMED_ERROR,
      "an empty votes table must raise a named error, not return []"
    );
  } else {
    assert.ok(getVotingRecord(db, "De La Rosa").length >= 0);
  }
});
