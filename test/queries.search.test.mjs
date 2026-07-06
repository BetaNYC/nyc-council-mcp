// Regression tests for local search: FTS tokenization and agency filtering.
//
// Bugs guarded against:
//  - searchBills used to wrap the entire query in double quotes, forcing an
//    exact-phrase match, so "housing preservation department" found nothing
//    even when all three words appeared in a title.
//  - the `agency` parameter only decorated snippets; it never constrained the
//    WHERE clause, so agency="DOT" returned NYPD bills too.
//  - FTS special characters in user input could crash MATCH.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { searchBills, buildFtsQuery } from "../dist/db/queries.js";
import { CREATE_TABLES } from "../dist/db/schema.js";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(CREATE_TABLES);
  const ins = db.prepare(`
    INSERT INTO bills (matter_id, file_number, title, type_name, status_name,
                       body_name, intro_date, sponsor_names, source_json)
    VALUES (?, ?, ?, 'Introduction', ?, ?, ?, ?, ?)
  `);
  const rows = [
    [1, "Int 0100-2024", "A Local Law in relation to protected bicycle lanes and the department of transportation", "Committee", "Committee on Transportation", "2024-03-01", "Nurse"],
    [2, "Int 0200-2024", "A Local Law in relation to bicycle parking requirements enforced by the police department", "Committee", "Committee on Public Safety", "2024-04-01", "Holden"],
    [3, "Int 0300-2024", "A Local Law in relation to public housing heating standards", "Adopted", "Committee on Public Housing", "2024-05-01", "Avilés"],
  ];
  for (const [id, file, title, status, body, date, sponsor] of rows) {
    ins.run(id, file, title, status, body, date, sponsor, JSON.stringify({ MatterTitle: title }));
  }
  return db;
}

test("buildFtsQuery: bare words become AND-ed quoted tokens", () => {
  assert.equal(buildFtsQuery("public housing"), '"public" "housing"');
});

test("buildFtsQuery: explicit quoted phrases are preserved", () => {
  assert.equal(buildFtsQuery('"bicycle lanes" safety'), '"bicycle lanes" "safety"');
});

test("buildFtsQuery: FTS special characters are neutralized", () => {
  assert.equal(buildFtsQuery("cats AND (dogs OR fish*)"), '"cats" "AND" "(dogs" "OR" "fish*)"');
  assert.equal(buildFtsQuery("   "), "");
});

test("searchBills: multi-word query matches bills containing all words (not exact phrase)", () => {
  const db = makeDb();
  // Words are adjacent nowhere: "bicycle ... transportation"
  const rows = searchBills(db, "bicycle transportation");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].file_number, "Int 0100-2024");
});

test("searchBills: FTS operator characters in input do not throw", () => {
  const db = makeDb();
  assert.doesNotThrow(() => searchBills(db, 'bicycle NEAR/3 ("lanes*'));
  assert.doesNotThrow(() => searchBills(db, "col:hack -x"));
  assert.deepEqual(searchBills(db, ""), []);
});

test("searchBills: agency parameter actually filters results", () => {
  const db = makeDb();
  // Both bills 1 and 2 match "bicycle"; only bill 1 mentions DOT phrases.
  const all = searchBills(db, "bicycle");
  assert.equal(all.length, 2);
  const dot = searchBills(db, "bicycle", { agency: "DOT" });
  assert.equal(dot.length, 1);
  assert.equal(dot[0].file_number, "Int 0100-2024");
  assert.ok(dot[0].snippet, "agency snippet still populated");
  const nypd = searchBills(db, "bicycle", { agency: "NYPD" });
  assert.equal(nypd.length, 1);
  assert.equal(nypd[0].file_number, "Int 0200-2024");
});
