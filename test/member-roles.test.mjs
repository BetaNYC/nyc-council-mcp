// Member roles from the archive (#28, tier 1: people/*.json → OfficeRecords[]).
// Committees, chairs, caucuses, party conferences and borough delegations, each
// with start/end, built offline with no token. Shapes copied from
// people/carmen-n-de-la-rosa.json (checked 2026-11-12). Party is NOT derived
// from any of this: a conference or caucus is reported as a membership only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { buildIndex } from "../dist/db/indexer.js";
import { memberRoles, committeeRoster, classifyBody } from "../dist/db/queries.js";
import { handleLocalTool } from "../dist/tools/local.js";

let rid = 1;
const rec = (personId, fullName, bodyName, title, memberType, start, end) => ({
  ID: rid++, GUID: "G", BodyID: 100 + rid, BodyName: bodyName, MemberType: memberType, Title: title,
  MemberTypeID: 3, FullName: fullName, PersonID: personId, Start: start, End: end, LastModified: "x",
});

const DLR = "Carmen N. De La Rosa";
const PEOPLE = {
  "carmen-n-de-la-rosa.json": {
    ID: 7806, FullName: DLR, FirstName: "Carmen N. ", LastName: "De La Rosa", IsActive: true,
    OfficeRecords: [
      rec(7806, DLR, "City Council", "Council Member", "PRIMARY COUNCIL MEMBERS", "2026-01-01T00:00:00Z", "2029-12-31T00:00:00Z"),
      rec(7806, DLR, "Committee on Civil Service and Labor", "CHAIRPERSON", "CHAIR", "2026-01-20T00:00:00Z", "2027-12-31T00:00:00Z"),
      rec(7806, DLR, "Committee on Technology", "Committee Member", "PRIMARY COUNCIL MEMBERS", "2026-01-20T00:00:00Z", "2027-12-31T00:00:00Z"),
      rec(7806, DLR, "Committee on Housing and Buildings", "Committee Member", "PRIMARY COUNCIL MEMBERS", "2022-01-20T00:00:00Z", "2023-12-31T00:00:00Z"),
      rec(7806, DLR, "Caucus - Progressive Caucus", "Council Member", "PRIMARY COUNCIL MEMBERS", "2026-01-01T00:00:00Z", "2027-12-31T00:00:00Z"),
      rec(7806, DLR, "Democratic Conference of the Council of the City of New York ", "Council Member", "PRIMARY COUNCIL MEMBERS", "2026-01-01T00:00:00Z", "2027-12-31T00:00:00Z"),
      rec(7806, DLR, "Manhattan Delegation of the New York City Council", "Co-Chair", "PRIMARY COUNCIL MEMBERS", "2026-01-01T00:00:00Z", "2027-12-31T00:00:00Z"),
    ],
  },
  "vickie-paladino.json": {
    ID: 7811, FullName: "Vickie Paladino", IsActive: true,
    OfficeRecords: [
      rec(7811, "Vickie Paladino", "Caucus - Common-Sense Caucus", "Council Member", "PRIMARY COUNCIL MEMBERS", "2026-01-01T00:00:00Z", "2027-12-31T00:00:00Z"),
      rec(7811, "Vickie Paladino", "Committee on Technology", "Committee Member", "PRIMARY COUNCIL MEMBERS", "2026-01-20T00:00:00Z", "2027-12-31T00:00:00Z"),
    ],
  },
  "frank-morano.json": {
    ID: 7899, FullName: "Frank Morano", IsActive: true,
    OfficeRecords: [
      rec(7899, "Frank Morano", "Committee on Technology", "CHAIRPERSON", "CHAIR", "2026-01-20T00:00:00Z", "2027-12-31T00:00:00Z"),
    ],
  },
};

async function db() {
  const root = mkdtempSync(join(tmpdir(), "legistar-roles-"));
  mkdirSync(join(root, "people"));
  for (const [f, p] of Object.entries(PEOPLE)) writeFileSync(join(root, "people", f), JSON.stringify(p));
  // One matter so the archive is not empty.
  mkdirSync(join(root, "introduction", "2026"), { recursive: true });
  writeFileSync(join(root, "introduction", "2026", "0001.json"), JSON.stringify({ ID: 1, File: "Int 0001-2026", Title: "x", TypeName: "Introduction" }));
  const dbPath = join(root, "t.db");
  await buildIndex({ archiveRoot: root, dbPath, full: true });
  // Second build: re-indexing must not duplicate office records.
  await buildIndex({ archiveRoot: root, dbPath, full: false });
  return new Database(dbPath, { readonly: true });
}

const ON = "2026-11-12";

test("classifyBody sorts Legistar bodies into kinds", () => {
  assert.equal(classifyBody("City Council"), "council");
  assert.equal(classifyBody("Committee on Technology"), "committee");
  assert.equal(classifyBody("SUBCOMMITTEE ON ZONING, PLANNING & LANDMARKS (NYCC)"), "committee");
  assert.equal(classifyBody("Select Committee on Libraries"), "committee");
  assert.equal(classifyBody("Caucus - Common-Sense Caucus"), "caucus");
  assert.equal(classifyBody("Democratic Conference of the Council of the City of New York "), "conference");
  assert.equal(classifyBody("Minority (Republican) Conference of the Council of the City of New York"), "conference");
  assert.equal(classifyBody("Press Conference"), "other");
  assert.equal(classifyBody("Bronx Delegation of the New York City Council"), "delegation");
  assert.equal(classifyBody("Task Force to Combat Hate"), "task_force");
});

test("De La Rosa: chairs Civil Service and Labor, sits on Technology, as of a date", async () => {
  const d = await db();
  const r = memberRoles(d, "Carmen De La Rosa", { as_of: ON });
  assert.equal(r.length, 1);
  const m = r[0];
  assert.equal(m.person_id, 7806);
  assert.deepEqual(m.chairs.map((x) => x.body_name), ["Committee on Civil Service and Labor"]);
  assert.deepEqual(m.committees.map((x) => [x.body_name, x.role]), [
    ["Committee on Civil Service and Labor", "chair"],
    ["Committee on Technology", "member"],
  ]);
  // Past membership is not current.
  assert.ok(!m.committees.some((x) => x.body_name === "Committee on Housing and Buildings"));
  assert.deepEqual(m.caucuses.map((x) => x.body_name), ["Caucus - Progressive Caucus"]);
  assert.deepEqual(m.conferences.map((x) => x.body_name), ["Democratic Conference of the Council of the City of New York"]);
  assert.deepEqual(m.delegations.map((x) => [x.body_name, x.role]), [["Manhattan Delegation of the New York City Council", "chair"]]);
  assert.equal(m.source, "Legistar archive (people/*.json OfficeRecords)");
  assert.ok(!("party" in m), "party is never derived from a caucus or conference");
  d.close();
});

test("include_past returns the full history with dates", async () => {
  const d = await db();
  const [m] = memberRoles(d, "De La Rosa", { include_past: true });
  const housing = m.committees.find((x) => x.body_name === "Committee on Housing and Buildings");
  assert.equal(housing.start, "2022-01-20");
  assert.equal(housing.end, "2023-12-31");
  d.close();
});

test("Paladino is in the Common-Sense Caucus; Morano is not", async () => {
  const d = await db();
  assert.deepEqual(memberRoles(d, "Vickie Paladino", { as_of: ON })[0].caucuses.map((c) => c.body_name), ["Caucus - Common-Sense Caucus"]);
  assert.deepEqual(memberRoles(d, "Frank Morano", { as_of: ON })[0].caucuses, []);
  d.close();
});

test("committee roster: chair first, then members, as of a date", async () => {
  const d = await db();
  const r = committeeRoster(d, "technology", { as_of: ON });
  assert.equal(r.length, 1);
  assert.equal(r[0].body_name, "Committee on Technology");
  assert.deepEqual(r[0].members.map((m) => [m.full_name, m.role]), [
    ["Frank Morano", "chair"],
    ["Carmen N. De La Rosa", "member"],
    ["Vickie Paladino", "member"],
  ]);
  // On a date when nobody sat on it, the committee is left out, not listed empty.
  assert.deepEqual(committeeRoster(d, "technology", { as_of: "2020-01-01" }), []);
  assert.equal(committeeRoster(d, "technology", { include_past: true }).length, 1);
  d.close();
});

test("tools: get_member_roles and committee_roster", async () => {
  const d = await db();
  const a = handleLocalTool("get_member_roles", { member_name: "De La Rosa", as_of: ON }, d);
  assert.ok(!a.isError, a.content[0].text);
  assert.equal(JSON.parse(a.content[0].text)[0].chairs[0].body_name, "Committee on Civil Service and Labor");
  const b = handleLocalTool("committee_roster", { committee: "Technology", as_of: ON }, d);
  assert.ok(!b.isError, b.content[0].text);
  assert.equal(JSON.parse(b.content[0].text)[0].members.length, 3);
  assert.ok(handleLocalTool("get_member_roles", { member_name: "x", as_of: "11/12/2026" }, d).isError);
  d.close();
});
