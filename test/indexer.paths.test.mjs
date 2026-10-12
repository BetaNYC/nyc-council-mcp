// Regression tests for archive path handling in the indexer (issue #12).
//
// The bug: indexer.ts built fast-glob patterns with
// path.join(archiveRoot, dir, "**", "*.json"). On Windows path.join emits
// backslashes, which fast-glob reads as escape characters, so every pattern
// matched nothing and `index` printed "bills=0 events=0 people=0 ... errors=0"
// as if it had succeeded. The same root cause breaks POSIX too, whenever the
// archive path itself contains glob syntax ("(x86)", "[...]"): the path was
// being interpreted as a pattern. The fix passes the archive root as
// fast-glob's `cwd` and keeps every pattern POSIX and relative.
//
// Test 1 reproduces the bug on any OS via a glob-syntax directory name. The
// Windows-separator half is covered by the windows-latest CI job, which runs
// every fixture-archive indexer test in this suite.
// Test 2 covers the "fail loud" half: an archive with no matching files must
// throw, not report an empty index as success, and must not touch an existing
// database.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { buildIndex } from "../dist/db/indexer.js";

function writeFixture(root) {
  const write = (rel, contents) => {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, contents);
  };
  // Shapes mirror the existing fixture tests (indexer.mattertypes,
  // indexer.eventitems-linkage), which mirror real archive files.
  write("people/901.json", JSON.stringify({ ID: 901, FullName: "Test Member", IsActive: true }));
  write(
    "introduction/2024/0001.json",
    JSON.stringify({
      ID: 1,
      File: "Int 0001-2024",
      Name: "Int 0001-2024",
      Title: "A Local Law in relation to bicycle transportation",
      TypeName: "Introduction",
      StatusName: "Committee",
      BodyName: "Committee on Transportation",
      IntroDate: "2024-02-01T00:00:00",
      Sponsors: [{ ID: 901, FullName: "Test Member", Slug: "test-member" }],
    })
  );
  write(
    "events/2024/2024-03-01_stated.json",
    JSON.stringify({ ID: 22000, Date: "2024-03-01T00:00:00", BodyName: "City Council", Items: [] })
  );
}

test("buildIndex finds archive files when the archive path contains glob syntax (#12)", async () => {
  const parent = mkdtempSync(join(tmpdir(), "legistar-paths-"));
  // "(x86)" and "[...]" are glob syntax; the old join()-built pattern matched
  // nothing under such a root, exactly as backslashes did on Windows.
  const archiveRoot = join(parent, "Program Files (x86)", "nyc_legislation [clone]");
  mkdirSync(archiveRoot, { recursive: true });
  writeFixture(archiveRoot);
  const dbPath = join(parent, "index.db");
  try {
    const stats = await buildIndex({ archiveRoot, dbPath, full: true });
    assert.equal(stats.people, 1, `expected 1 person, got ${stats.people}`);
    assert.equal(stats.bills, 1, `expected 1 bill, got ${stats.bills}`);
    assert.equal(stats.events, 1, `expected 1 event, got ${stats.events}`);
    assert.equal(stats.errors, 0);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("buildIndex throws on an archive with no JSON files and leaves an existing index untouched (#12)", async () => {
  const parent = mkdtempSync(join(tmpdir(), "legistar-empty-"));
  const goodRoot = join(parent, "good");
  const emptyRoot = join(parent, "empty");
  mkdirSync(goodRoot, { recursive: true });
  // Source directories exist but hold no JSON: the shape of the Windows
  // failure, where the clone was present and nothing matched.
  mkdirSync(join(emptyRoot, "introduction"), { recursive: true });
  mkdirSync(join(emptyRoot, "people"), { recursive: true });
  writeFixture(goodRoot);
  const dbPath = join(parent, "index.db");
  try {
    await buildIndex({ archiveRoot: goodRoot, dbPath, full: true });

    const origError = console.error;
    console.error = () => {}; // silence the expected per-directory warnings
    try {
      await assert.rejects(
        buildIndex({ archiveRoot: emptyRoot, dbPath, full: true }),
        /No archive JSON files found/
      );
    } finally {
      console.error = origError;
    }

    // The full rebuild must not have dropped the existing index first.
    const db = new Database(dbPath, { readonly: true });
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bills").get().n, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM people").get().n, 1);
    } finally {
      db.close();
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
