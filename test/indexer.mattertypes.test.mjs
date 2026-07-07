// Regression test for the local indexer's matter-type coverage.
//
// The bug: buildIndex walked only `introduction/**`, so every Resolution and
// Land Use matter in the jehiah/nyc_legislation archive (~40% of all matters)
// was silently absent from the local index — even though the README promised
// "all bills and resolutions". Full-text search for words that appear only in
// resolutions (e.g. "designation", the phrase "CAPITAL PROGRAM FOR THE ENSUING
// THREE YEARS") therefore returned nothing.
//
// This test builds a tiny fixture archive with all three matter-type
// directories plus a `resubmit/` file (which is NOT a matter and must be
// ignored), runs the real buildIndex, and asserts every type is searchable.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { buildIndex } from "../dist/db/indexer.js";
import { searchBills, aggregateBills } from "../dist/db/queries.js";

// Field shape mirrors real archive files (verified 2026-07-07 against a local
// jehiah/nyc_legislation clone: resolution/2014/0048.json et al.).
function matter(id, file, typeName, title, year) {
  return JSON.stringify({
    ID: id,
    File: file,
    Name: file,
    Title: title,
    TypeName: typeName,
    StatusName: "Adopted",
    BodyName: "Committee on Finance",
    IntroDate: `${year}-02-01T00:00:00`,
    Sponsors: [{ ID: 900 + id, FullName: "Test Member", Slug: "test-member" }],
  });
}

function buildFixtureArchive() {
  const root = mkdtempSync(join(tmpdir(), "legistar-fixture-"));

  const write = (rel, contents) => {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, contents);
  };

  write(
    "introduction/2024/0001.json",
    matter(1, "Int 0001-2024", "Introduction", "A Local Law in relation to bicycle transportation", 2024)
  );
  // A real-world resolution title, including the phrase the research sessions
  // grepped for and the discovery words that used to return nothing.
  write(
    "resolution/2007/0100.json",
    matter(
      2,
      "Res 0100-2007",
      "Resolution",
      "Resolution approving the CAPITAL PROGRAM FOR THE ENSUING THREE YEARS and the budget designation for transparency",
      2007
    )
  );
  write(
    "land_use/2013/0821.json",
    matter(3, "LU 0821-2013", "Land Use Application", "Application for a rezoning in Brooklyn", 2013)
  );
  // NOT a matter: a {Resubmitted:[{FromFile,ToFile}]} mapping. Must be ignored.
  write("resubmit/2022.json", JSON.stringify({ Resubmitted: [{ FromFile: "Int 0930-2018", ToFile: "Int 0008-2022" }] }));
  write("people/900.json", JSON.stringify({ ID: 901, FullName: "Test Member", IsActive: true }));

  return root;
}

test("buildIndex indexes Introductions, Resolutions, and Land Use — not resubmit", async () => {
  const archiveRoot = buildFixtureArchive();
  const dbPath = join(archiveRoot, "index.db");

  try {
    const stats = await buildIndex({ archiveRoot, dbPath, full: true });

    // Three matter files across three type directories; the resubmit dict is
    // not a matter and must not be counted.
    assert.equal(stats.bills, 3, `expected 3 bills, got ${stats.bills}`);

    const db = new Database(dbPath, { readonly: true });
    try {
      // Resolution is now searchable by text that lives only in resolutions —
      // the exact failure the research sessions hit.
      const capital = searchBills(db, "capital program");
      assert.equal(capital.length, 1);
      assert.equal(capital[0].file_number, "Res 0100-2007");

      const designation = searchBills(db, "designation transparency");
      assert.equal(designation.length, 1);
      assert.equal(designation[0].type_name, "Resolution");

      // Land Use matters are indexed too.
      const rezoning = searchBills(db, "rezoning");
      assert.equal(rezoning.length, 1);
      assert.equal(rezoning[0].file_number, "LU 0821-2013");

      // All three types show up in the aggregate.
      const byType = aggregateBills(db, "type");
      const labels = byType.results.map((r) => r.label).sort();
      assert.deepEqual(labels, ["Introduction", "Land Use Application", "Resolution"]);
    } finally {
      db.close();
    }
  } finally {
    rmSync(archiveRoot, { recursive: true, force: true });
  }
});
