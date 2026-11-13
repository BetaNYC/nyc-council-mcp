// Council districts and terms (#28, tier 2: NYC Open Data uvw5-9znb, vendored).
//
// The City publishes every member's terms with district: 558 rows, 215 people,
// 1999 to now (fetched 2026-11-12). council_member_id is the Legistar
// person_id: all 558 rows join to the index's people table with no name
// comparison. A returning member keeps the same id (Brewer, 5259: out
// 2013-12-31, back 2022-01-01). 52 rows have no district. On 2026-11-12 the
// snapshot shows 50 of 51 seats filled: District 3's last term (Bottcher) ended
// 2026-02-03. Row shapes below are copied from that fetch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { buildIndex } from "../dist/db/indexer.js";
import { memberRoles, districtMember, TERMS_SOURCE } from "../dist/db/queries.js";
import { handleLocalTool, LOCAL_TOOL_DEFS } from "../dist/tools/local.js";
import { CREATE_TABLES } from "../dist/db/schema.js";
import { withMemberTerms } from "../dist/tools/member-terms.js";

const row = (name, id, start, end, district, office) => ({
  name,
  council_member_id: String(id),
  term_start: `${start}T00:00:00.000`,
  term_end: `${end}T00:00:00.000`,
  ...(district == null ? {} : { district: String(district) }),
  office_id: String(office),
});

const SNAPSHOT = {
  dataset: "uvw5-9znb",
  name: "City Council Members (1999 to Present)",
  url: "https://data.cityofnewyork.us/d/uvw5-9znb",
  fetched_at: "2026-11-12T16:00:00Z",
  rows_updated_at: "2026-04-10T12:00:29Z",
  rows: [
    row("Gale A. Brewer", 5259, "2026-01-01", "2029-12-31", 6, 5805),
    row("Gale A. Brewer", 5259, "2022-01-01", "2023-12-31", 6, 4481),
    row("Gale A. Brewer", 5259, "2010-01-01", "2013-12-31", 6, 2775),
    row("Helen K. Rosenthal", 5300, "2014-01-01", "2021-12-31", 6, 3001),
    row("Erik D. Bottcher", 7720, "2026-01-01", "2026-02-03", 3, 5790),
    row("Erik D. Bottcher", 7720, "2024-01-01", "2025-12-31", 3, 5200),
    row("Justin L. Brannan", 7748, "2024-01-01", "2025-12-31", null, 5218),
    // Brannan held District 47 before; Treyger held it until 2021. The City's
    // 2024-25 row for Brannan has no district (52 rows are like this).
    row("Justin L. Brannan", 7748, "2022-01-01", "2023-12-31", 47, 4480),
    row("Mark Treyger", 5400, "2014-01-01", "2021-12-31", 47, 3100),
    // Real overlap in the City's file: Weprin to 2015-01-31, Grodenchik from 2014-01-01.
    row("Mark S. Weprin", 5500, "2010-01-01", "2015-01-31", 23, 2700),
    row("Barry S. Grodenchik", 5600, "2014-01-01", "2017-12-31", 23, 3200),
  ],
};

const PEOPLE = {
  "gale-a-brewer.json": { ID: 5259, FullName: "Gale A. Brewer", IsActive: true, OfficeRecords: [] },
  "helen-k-rosenthal.json": { ID: 5300, FullName: "Helen K. Rosenthal", IsActive: false, OfficeRecords: [] },
  "erik-d-bottcher.json": { ID: 7720, FullName: "Erik D. Bottcher", IsActive: false, OfficeRecords: [] },
  "justin-l-brannan.json": { ID: 7748, FullName: "Justin L. Brannan", IsActive: false, OfficeRecords: [] },
  "mark-treyger.json": { ID: 5400, FullName: "Mark Treyger", IsActive: false, OfficeRecords: [] },
  "mark-s-weprin.json": { ID: 5500, FullName: "Mark S. Weprin", IsActive: false, OfficeRecords: [] },
  "barry-s-grodenchik.json": { ID: 5600, FullName: "Barry S. Grodenchik", IsActive: false, OfficeRecords: [] },
  // Real case, 2026-11-12: Legistar has Carl Wilson as a Council Member from
  // 2026-05-13, but the City's file (last updated 2026-04-10) has no term for him.
  "carl-wilson.json": {
    ID: 7874, FullName: "Carl Wilson", IsActive: true,
    OfficeRecords: [{ ID: 90001, GUID: "G", BodyID: 1, BodyName: "City Council", MemberType: "PRIMARY COUNCIL MEMBERS",
      Title: "Council Member", MemberTypeID: 3, FullName: "Carl Wilson", PersonID: 7874,
      Start: "2026-05-13T00:00:00Z", End: "2029-12-31T00:00:00Z", LastModified: "x" }],
  },
  // The Public Advocate sits on the Council with no district; never a candidate.
  "jumaane-williams.json": {
    ID: 7780, FullName: "Public Advocate Jumaane Williams", IsActive: true,
    OfficeRecords: [{ ID: 90002, GUID: "G", BodyID: 1, BodyName: "City Council", MemberType: "PRIMARY PUBLIC ADVOCATE",
      Title: "Public Advocate", MemberTypeID: 4, FullName: "Public Advocate Jumaane Williams", PersonID: 7780,
      Start: "2026-01-01T00:00:00Z", End: "2029-12-31T00:00:00Z", LastModified: "x" }],
  },
};

async function built(snapshot = SNAPSHOT) {
  const root = mkdtempSync(join(tmpdir(), "legistar-terms-"));
  mkdirSync(join(root, "people"));
  for (const [f, p] of Object.entries(PEOPLE)) writeFileSync(join(root, "people", f), JSON.stringify(p));
  mkdirSync(join(root, "introduction", "2026"), { recursive: true });
  writeFileSync(join(root, "introduction", "2026", "0001.json"), JSON.stringify({ ID: 1, File: "Int 0001-2026", Title: "x", TypeName: "Introduction" }));
  const termsPath = join(root, "terms.json");
  writeFileSync(termsPath, JSON.stringify(snapshot));
  const dbPath = join(root, "t.db");
  // No network: fetch throws if anything tries it during a build.
  const realFetch = global.fetch;
  global.fetch = () => { throw new Error("no network during a build"); };
  try {
    await buildIndex({ archiveRoot: root, dbPath, full: true, termsPath });
    await buildIndex({ archiveRoot: root, dbPath, full: false, termsPath });
  } finally {
    global.fetch = realFetch;
  }
  return new Database(dbPath, { readonly: true });
}

test("the vendored snapshot ships with the package and joins on person_id", () => {
  const snap = JSON.parse(readFileSync(new URL("../data/council-member-terms.json", import.meta.url)));
  assert.equal(snap.dataset, "uvw5-9znb");
  assert.match(snap.fetched_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(snap.rows.length >= 558);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  assert.ok(pkg.files.includes("data/council-member-terms.json"), "the snapshot must be in the published package");
});

test("Brewer: one person, district 6, every term including the gap", async () => {
  const d = await built();
  const [m] = memberRoles(d, "Gale Brewer", { as_of: "2026-06-01" });
  assert.equal(m.district, 6);
  assert.deepEqual(m.terms.map((t) => [t.term_start, t.term_end, t.office_id]), [
    ["2026-01-01", "2029-12-31", 5805],
    ["2022-01-01", "2023-12-31", 4481],
    ["2010-01-01", "2013-12-31", 2775],
  ]);
  assert.equal(m.terms_source, TERMS_SOURCE);
  // In the gap she held no seat.
  assert.equal(memberRoles(d, "Gale Brewer", { as_of: "2019-06-01" })[0].district, null);
  d.close();
});

test("district 6 has a different member in 2019 than in 2026", async () => {
  const d = await built();
  assert.equal(districtMember(d, 6, "2019-06-01").member.full_name, "Helen K. Rosenthal");
  assert.equal(districtMember(d, 6, "2026-06-01").member.full_name, "Gale A. Brewer");
  d.close();
});

test("a seat nobody holds on the date is vacant, not its last member", async () => {
  const d = await built();
  const now = districtMember(d, 3, "2026-07-24");
  assert.equal(now.status, "vacant");
  assert.equal(now.member, null);
  assert.equal(now.previous.full_name, "Erik D. Bottcher");
  assert.equal(now.previous.term_end, "2026-02-03");
  const before = districtMember(d, 3, "2026-01-15");
  assert.equal(before.status, "filled");
  assert.equal(before.member.person_id, 7720);
  d.close();
});

test("a vacant seat names Council Members the City's file is missing, without guessing", async () => {
  const d = await built();
  const r = districtMember(d, 3, "2026-07-24");
  assert.equal(r.status, "vacant", "the City's file decides the seat; Legistar does not");
  assert.deepEqual(r.unlisted_council_members.map((m) => [m.person_id, m.full_name, m.start]), [[7874, "Carl Wilson", "2026-05-13"]]);
  assert.match(r.note, /not in the City's terms file/);
  // Before he took office, nobody is unlisted.
  assert.equal(districtMember(d, 3, "2026-03-01").unlisted_council_members, undefined);
  // A filled seat does not carry the list.
  assert.equal(districtMember(d, 6, "2026-07-24").unlisted_council_members, undefined);
  d.close();
});

test("a term with no district indexes and returns null", async () => {
  const d = await built();
  const [m] = memberRoles(d, "Brannan", { as_of: "2025-06-01" });
  assert.equal(m.district, null);
  assert.equal(m.terms.length, 2);
  assert.equal(m.terms[0].district, null);
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM member_terms").get().n, SNAPSHOT.rows.length);
  d.close();
});

test("the build records the snapshot's fetch date", async () => {
  const d = await built();
  const v = d.prepare("SELECT value FROM index_state WHERE key = 'member_terms_fetched_at'").get().value;
  assert.equal(v, SNAPSHOT.fetched_at);
  assert.equal(districtMember(d, 6, "2026-06-01").snapshot_fetched_at, SNAPSHOT.fetched_at);
  d.close();
});

test("a date after the snapshot carries a warning", async () => {
  const d = await built();
  assert.equal(districtMember(d, 6, "2026-06-01").warning, undefined);
  assert.match(districtMember(d, 3, "2027-03-01").warning, /after the snapshot/);
  d.close();
});

test("district_member tool: validates input", async () => {
  const d = await built();
  const ok = handleLocalTool("district_member", { district: 6, as_of: "2026-06-01" }, d);
  assert.ok(!ok.isError, ok.content[0].text);
  assert.equal(JSON.parse(ok.content[0].text).member.person_id, 5259);
  assert.ok(handleLocalTool("district_member", { district: 52 }, d).isError);
  assert.ok(handleLocalTool("district_member", { district: 6, as_of: "6/1/2026" }, d).isError);
  assert.ok(LOCAL_TOOL_DEFS.some((t) => t.name === "district_member"));
  d.close();
});

test("live get_council_member gains district and terms from the index", async () => {
  const d = await built();
  const res = { content: [{ type: "text", text: JSON.stringify([{ PersonId: 5259, PersonFullName: "Gale A. Brewer" }, { PersonId: 1, PersonFullName: "Nobody" }]) }] };
  const out = JSON.parse(withMemberTerms(res, d, "2026-06-01").content[0].text);
  assert.equal(out[0].district, 6);
  assert.equal(out[0].terms.length, 3);
  assert.equal(out[0].terms_source, TERMS_SOURCE);
  assert.equal(out[1].district, null);
  assert.deepEqual(out[1].terms, []);
  // Errors pass through untouched.
  const err = { content: [{ type: "text", text: "Error: x" }], isError: true };
  assert.equal(withMemberTerms(err, d), err);
  d.close();
});

test("a missing snapshot file does not break the build", async () => {
  const root = mkdtempSync(join(tmpdir(), "legistar-terms-missing-"));
  mkdirSync(join(root, "introduction", "2026"), { recursive: true });
  writeFileSync(join(root, "introduction", "2026", "0001.json"), JSON.stringify({ ID: 1, File: "Int 0001-2026", Title: "x", TypeName: "Introduction" }));
  const dbPath = join(root, "t.db");
  await buildIndex({ archiveRoot: root, dbPath, full: true, termsPath: join(root, "nope.json") });
  const d = new Database(dbPath, { readonly: true });
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM member_terms").get().n, 0);
  d.close();
});

// Review findings, 2026-11-12 (#48).

test("a seat held by someone the City lists with no district is 'unknown', not 'vacant'", async () => {
  const d = await built();
  const r = districtMember(d, 47, "2025-06-01");
  assert.equal(r.status, "unknown");
  assert.equal(r.member, null);
  assert.deepEqual(r.terms_without_district.map((t) => t.person_id), [7748]);
  assert.match(r.note, /no district/);
  // Before that, the seat resolves normally.
  assert.equal(districtMember(d, 47, "2023-06-01").member.person_id, 7748);
  d.close();
});

test("two terms on one date are both shown, not silently resolved", async () => {
  const d = await built();
  const r = districtMember(d, 23, "2014-06-01");
  assert.equal(r.status, "filled");
  assert.deepEqual([r.member.person_id, ...r.overlapping_terms.map((t) => t.person_id)].sort(), [5500, 5600]);
  assert.match(r.note, /overlap/);
  assert.equal(districtMember(d, 23, "2016-06-01").overlapping_terms, undefined);
  d.close();
});

test("impossible dates are rejected", async () => {
  const d = await built();
  assert.ok(handleLocalTool("district_member", { district: 3, as_of: "2026-02-30" }, d).isError);
  assert.ok(handleLocalTool("get_member_roles", { member_name: "Brewer", as_of: "2026-13-01" }, d).isError);
  d.close();
});

test("an index with no council terms is an error, not an empty seat", () => {
  const db = new Database(":memory:");
  db.exec(CREATE_TABLES);
  assert.throws(() => districtMember(db, 3, "2026-06-01"), /Re-run the indexer/);
});
