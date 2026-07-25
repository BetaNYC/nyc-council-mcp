// Regression test for the schema-migration gotcha in issue #30.
//
// CREATE_TABLES uses CREATE TABLE IF NOT EXISTS. On a corpus that already has
// the OLD `votes` table (vote_id PRIMARY KEY, schema v4), simply changing the
// DDL string does nothing — the old table persists and the v5 primary-key change
// is silently ignored. The fix: a schema-triggered full rebuild DROPs the data
// tables before recreating them, so the current schema is actually applied.
//
// This test stands up a real old-shape votes table, rolls schema_version back to
// 4, runs the real buildIndex, and asserts the votes table now has the v5
// composite primary key and the old row is gone — the behavior that fails
// without the DROP.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { buildIndex } from "../dist/db/indexer.js";

function matterWithRollCall(id, file, typeName) {
  return JSON.stringify({
    ID: id,
    File: file,
    Name: file,
    Title: "A matter with a roll call",
    TypeName: typeName,
    History: [
      {
        ID: 700100,
        Action: "Approved, by Council",
        Date: "2024-06-01T17:00:00Z",
        BodyName: "City Council",
        EventID: 700101,
        PassedFlag: 1,
        PassedFlagName: "Pass",
        Votes: [
          { ID: 7814, Slug: "linda-lee", FullName: "Linda Lee", VoteID: 15, Vote: "Affirmative", Result: 1, Sort: 1 },
          { ID: 7803, Slug: "julie-menin", FullName: "Julie Menin", VoteID: 16, Vote: "Negative", Result: 0, Sort: 2 },
        ],
      },
    ],
  });
}

function buildArchive() {
  const root = mkdtempSync(join(tmpdir(), "legistar-migration-"));
  const abs = join(root, "introduction/2024/0001.json");
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, matterWithRollCall(1, "Int 0001-2024", "Introduction"));
  return root;
}

function votesColumns(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare("PRAGMA table_info(votes)").all();
  } finally {
    db.close();
  }
}

test("a v4→v5 rebuild applies the new votes primary key (the migration gotcha)", async () => {
  const root = buildArchive();
  const dbPath = join(root, "index.db");
  try {
    // 1. Build a healthy v5 corpus.
    await buildIndex({ archiveRoot: root, dbPath, full: true });

    // 2. Rewind to a v4 corpus: replace votes with the OLD vote_id-keyed shape,
    //    seed a bogus row, and stamp schema_version = 4. Leave indexed_sources
    //    untouched so ONLY the schema change can force the rebuild.
    const setup = new Database(dbPath);
    try {
      setup.exec("DROP TABLE votes");
      setup.exec(`
        CREATE TABLE votes (
          vote_id       INTEGER PRIMARY KEY,
          event_item_id INTEGER NOT NULL,
          person_id     INTEGER,
          person_name   TEXT,
          vote_value    TEXT,
          matter_id     INTEGER
        )`);
      setup.prepare(
        `INSERT INTO votes (vote_id, event_item_id, person_id, person_name, vote_value, matter_id)
         VALUES (999, 111, 222, 'Bogus Member', 'Affirmative', 333)`
      ).run();
      setup.prepare("UPDATE index_state SET value = '4' WHERE key = 'schema_version'").run();
    } finally {
      setup.close();
    }

    // Precondition: the corpus really is in the old shape.
    assert.ok(votesColumns(dbPath).some((c) => c.name === "vote_id"), "setup installed the old vote_id schema");

    // 3. The next index run detects schema 4 ≠ 5 and forces a full rebuild.
    await buildIndex({ archiveRoot: root, dbPath, full: false });

    // 4. The votes table now has the v5 composite primary key, no vote_id.
    const cols = votesColumns(dbPath);
    assert.ok(!cols.some((c) => c.name === "vote_id"), "vote_id column is gone after the v5 migration");
    const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    assert.deepEqual(pk, ["event_item_id", "person_id"], "the new composite primary key is applied");

    // 5. The old-shape row was dropped; the real roll call was reindexed.
    const db = new Database(dbPath, { readonly: true });
    try {
      const bogus = db.prepare("SELECT COUNT(*) AS n FROM votes WHERE person_name = 'Bogus Member'").get().n;
      assert.equal(bogus, 0, "the drop cleared the old-shape rows");
      const real = db.prepare("SELECT COUNT(*) AS n FROM votes").get().n;
      assert.equal(real, 2, "the matter's roll call was reindexed under the new schema");
      const schema = db.prepare("SELECT value FROM index_state WHERE key = 'schema_version'").get().value;
      assert.equal(schema, "5", "schema_version re-stamped to 5, so the rebuild fires once");
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
