// Regression test for issue #32: an incremental index run must fall back to a
// FULL rebuild when the corpus was built under different conditions than the
// current code — otherwise coverage that widened AFTER the corpus was first
// built stays silently missing.
//
// The real bug: the corpus was first indexed when the walker only read
// introduction/. MATTER_DIRS later grew to include resolution/ and land_use/,
// but every run since was incremental, so the ~8,400 pre-existing resolution /
// land-use files (all with old mtimes) were never picked up. Measured on the
// live corpus: 12,887 Introductions but only 119/6,074 Resolutions and
// 43/2,507 Land Use Applications — ~98% of two whole types silently absent,
// with search returning real, correctly-formatted, radically incomplete results.
//
// Two triggers each force a full rebuild; both are exercised below against the
// REAL buildIndex over a temp fixture archive (mkdtempSync), asserting DB
// contents (external behavior), not internal helpers:
//   1. the indexed source set changed — including the ABSENT key, which is
//      exactly today's live corpus. THIS is the trigger that fixes this ticket.
//   2. schema_version changed — the mechanism #30's 4→5 bump rides to
//      self-repair the corpus (that bump has now shipped).
// Plus a guard that an ordinary unchanged run does NOT turn into a full crawl.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { buildIndex } from "../dist/db/indexer.js";

// mtimes drive the incremental cutoff. OLD is before any last_indexed_at an
// incremental run would compute; FUTURE is safely after it.
const OLD = new Date("2020-01-01T00:00:00Z");
const FUTURE = new Date(Date.now() + 3_600_000);

// Minimal matter shape the indexer needs (ID/File/Title/TypeName). Mirrors the
// jehiah/nyc_legislation archive field names used by indexer.ts.
function matter(id, file, typeName, title) {
  return JSON.stringify({ ID: id, File: file, Name: file, Title: title, TypeName: typeName });
}

function newArchive() {
  return mkdtempSync(join(tmpdir(), "legistar-fullrebuild-"));
}

// Write a matter file and stamp its mtime (the incremental cutoff reads mtime).
function writeMatter(root, rel, json, mtime) {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, json);
  utimesSync(abs, mtime, mtime);
}

// The bills actually in the DB — the external truth these tests assert on.
function billNumbers(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare("SELECT file_number FROM bills ORDER BY file_number").all().map((r) => r.file_number);
  } finally {
    db.close();
  }
}

// Mutate index_state to simulate a corpus built under other conditions.
function editState(dbPath, fn) {
  const db = new Database(dbPath);
  try {
    fn(db);
  } finally {
    db.close();
  }
}

test("source-set widening: an absent indexed_sources key forces a full rebuild (issue #32)", async () => {
  const root = newArchive();
  const dbPath = join(root, "index.db");
  try {
    // 1. Corpus first built covering only introduction/ (old mtime).
    writeMatter(root, "introduction/2024/0001.json", matter(1, "Int 0001-2024", "Introduction", "A local law"), OLD);
    await buildIndex({ archiveRoot: root, dbPath, full: true });

    // 2. Simulate today's live corpus: the indexed_sources key does not exist
    //    (it predates this tracking). schema_version is left at 4 so ONLY the
    //    source-set trigger can explain a full rebuild.
    editState(dbPath, (db) => db.prepare("DELETE FROM index_state WHERE key = 'indexed_sources'").run());

    // 3. resolution/ and land_use/ files already exist on disk with OLD mtimes —
    //    the analogue of the ~8,400 matters an incremental cutoff skips forever.
    writeMatter(root, "resolution/2007/0100.json", matter(2, "Res 0100-2007", "Resolution", "A resolution"), OLD);
    writeMatter(root, "land_use/2013/0821.json", matter(3, "LU 0821-2013", "Land Use Application", "An application"), OLD);

    // 4. An INCREMENTAL run. Without the fix, the old mtimes are skipped and
    //    these two never appear. With the fix, the absent key forces a full
    //    rebuild that re-reads them.
    const stats = await buildIndex({ archiveRoot: root, dbPath, full: false });

    assert.deepEqual(
      billNumbers(dbPath),
      ["Int 0001-2024", "LU 0821-2013", "Res 0100-2007"],
      "resolution and land use must be picked up despite old mtimes"
    );
    assert.equal(stats.skipped, 0, "a forced full rebuild skips nothing on mtime");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("schema-version change forces a full rebuild and self-clears (mechanism for issue #30)", async () => {
  const root = newArchive();
  const dbPath = join(root, "index.db");
  try {
    writeMatter(root, "introduction/2024/0001.json", matter(1, "Int 0001-2024", "Introduction", "A local law"), OLD);
    await buildIndex({ archiveRoot: root, dbPath, full: true });

    // A resolution appears on disk with an OLD mtime, and the stored schema is
    // rolled back to '4' to simulate a corpus indexed under the previous schema
    // (the real 4→5 bump this ticket ships). The source set is left unchanged so
    // ONLY the schema trigger can explain a rebuild.
    writeMatter(root, "resolution/2007/0100.json", matter(2, "Res 0100-2007", "Resolution", "A resolution"), OLD);
    editState(dbPath, (db) => db.prepare("UPDATE index_state SET value = '4' WHERE key = 'schema_version'").run());

    const stats = await buildIndex({ archiveRoot: root, dbPath, full: false });

    assert.deepEqual(
      billNumbers(dbPath),
      ["Int 0001-2024", "Res 0100-2007"],
      "a schema mismatch must trigger a full rebuild that indexes the old-mtime resolution"
    );
    assert.equal(stats.skipped, 0, "a forced full rebuild skips nothing on mtime");

    // The successful rebuild re-stamps the current schema version, so the loop
    // closes — a future bump repairs the corpus once, not on every run forever.
    editState(dbPath, (db) => {
      const v = db.prepare("SELECT value FROM index_state WHERE key = 'schema_version'").get().value;
      assert.equal(v, "5", "the rebuild must re-stamp the current schema version");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no false trigger: an unchanged incremental run still skips by mtime (no full crawl)", async () => {
  const root = newArchive();
  const dbPath = join(root, "index.db");
  try {
    writeMatter(root, "introduction/2024/0001.json", matter(1, "Int 0001-2024", "Introduction", "First"), OLD);
    await buildIndex({ archiveRoot: root, dbPath, full: true });

    // Nothing about the corpus conditions changed (schema and source set stay as
    // stamped). Add one OLD-mtime file (must be skipped) and one FUTURE-mtime
    // file (must be picked up) — proving the run is genuinely incremental and
    // the fix did NOT turn every run into a full crawl.
    writeMatter(root, "introduction/2024/0002.json", matter(2, "Int 0002-2024", "Introduction", "Old, skip me"), OLD);
    writeMatter(root, "introduction/2024/0003.json", matter(3, "Int 0003-2024", "Introduction", "New, index me"), FUTURE);

    const stats = await buildIndex({ archiveRoot: root, dbPath, full: false });

    // 0002 absent proves NO forced full rebuild fired; 0003 present proves the
    // incremental path is alive and did real work.
    assert.deepEqual(
      billNumbers(dbPath),
      ["Int 0001-2024", "Int 0003-2024"],
      "incremental must skip the old-mtime file and pick up the new one"
    );
    assert.ok(stats.skipped >= 1, "the old-mtime file must be counted as skipped");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
