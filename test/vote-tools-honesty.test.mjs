// Vote tools must never answer a vote question with a bare [].
//
// Bug guarded against (issue #19): the `votes` table is never populated, so
// getVotingRecord / voteBreakdown returned [] for every member, including
// four-year incumbents. An empty array is indistinguishable from a true
// negative — a caller reads [] from a tool named get_voting_record as "this
// member cast no votes." In a transparency tool that is the worst available
// failure mode.
//
// Scope note: this does NOT assert anything about vote data existing. It
// asserts that the absence is *named*. See issue #19 group 2 for the deferred
// RollCall-indexing question (archive RollCall is attendance, not aye/nay).

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
    // Honest about provenance: not indexed locally, and not in the archive at all.
    assert.match(err.message, /archive/i, "says the positions are absent from the archive");
    assert.match(err.message, /Legistar/i, "names the live API as where they would come from");
    assert.match(err.message, /get_votes/, "names a tool that does return positions");
  }
});

test("a populated votes table works normally — the guard is not a hard disable", () => {
  const db = emptyDb();
  db.prepare(
    `INSERT INTO votes (vote_id, event_item_id, person_id, person_name, vote_value, matter_id)
     VALUES (1, 100, 7, 'Carmen De La Rosa', 'Affirmative', 55)`
  ).run();
  db.prepare(
    `INSERT INTO events (event_id, date, source_json) VALUES (9, '2024-06-01', '{}')`
  ).run();
  db.prepare(
    `INSERT INTO event_items (event_item_id, event_id, matter_id, file_number, title, action_name)
     VALUES (100, 9, 55, 'Int 0349-2024', 'A Local Law', 'Approved')`
  ).run();

  const rows = getVotingRecord(db, "De La Rosa");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].file_number, "Int 0349-2024");
  assert.equal(voteBreakdown(db, "Int 0349-2024").length, 1);
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
