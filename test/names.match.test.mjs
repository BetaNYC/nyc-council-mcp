// Member-name matching (#40).
//
// Legistar stores many active members with a middle initial ("Carmen N. De La
// Rosa"), a trailing space ("Virginia Maloney "), a double space ("Althea V.
// Stevens") or accents ("Amanda C. Farías", "Chi A. Ossé"). Checked live
// 2026-11-12: about 30 of 181 active Persons rows have one of these. A plain
// substring search for the name a person types, "Carmen De La Rosa" or
// "Amanda Farias", finds nothing. Matching is now token-based, case- and
// accent-insensitive, and ignores middle initials and extra spaces.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { nameMatches, normalizeName } from "../dist/names.js";
import { getCouncilMember } from "../dist/legistar.js";
import { getVotingRecord, coSponsors } from "../dist/db/queries.js";
import { CREATE_TABLES } from "../dist/db/schema.js";

// Real PersonFullName values (live, 2026-11-12), including their odd spacing.
const PEOPLE = [
  { PersonId: 7806, PersonFullName: "Carmen N. De La Rosa", PersonActiveFlag: 1 },
  { PersonId: 7810, PersonFullName: "Amanda C. Farías", PersonActiveFlag: 1 },
  { PersonId: 7809, PersonFullName: "Althea V.  Stevens", PersonActiveFlag: 1 },
  { PersonId: 7823, PersonFullName: "Chi A. Ossé", PersonActiveFlag: 1 },
  { PersonId: 5259, PersonFullName: "Gale A. Brewer", PersonActiveFlag: 1 },
  { PersonId: 7894, PersonFullName: "Virginia Maloney ", PersonActiveFlag: 1 },
  { PersonId: 7870, PersonFullName: "John LaRosa ", PersonActiveFlag: 1 },
];

test("normalizeName folds case, accents, punctuation and spaces", () => {
  assert.equal(normalizeName("  Amanda C. Farías "), "amanda c farias");
  assert.equal(normalizeName("Althea V.  Stevens"), "althea v stevens");
});

test("nameMatches: the names people actually type", () => {
  assert.ok(nameMatches("Carmen De La Rosa", "Carmen N. De La Rosa"));
  assert.ok(nameMatches("carmen de la rosa", "Carmen N. De La Rosa"));
  assert.ok(nameMatches("Carmen N De La Rosa", "Carmen N. De La Rosa"));
  assert.ok(nameMatches("Amanda Farias", "Amanda C. Farías"));
  assert.ok(nameMatches("Chi Osse", "Chi A. Ossé"));
  assert.ok(nameMatches("Althea Stevens", "Althea V.  Stevens"));
  assert.ok(nameMatches("Brewer, Gale", "Gale A. Brewer"));
  // Partial names keep working, as the old substring search did.
  assert.ok(nameMatches("De La Rosa", "Carmen N. De La Rosa"));
  assert.ok(nameMatches("Malon", "Virginia Maloney "));
});

test("nameMatches: every word must match, so no false friends", () => {
  assert.ok(!nameMatches("Carmen De La Rosa", "John LaRosa "));
  assert.ok(!nameMatches("Amanda Stevens", "Althea V.  Stevens"));
  assert.ok(!nameMatches("", "Gale A. Brewer"));
  assert.ok(!nameMatches("Gale Brewer", null));
});

test("get_council_member (live) finds members by the name people type", async () => {
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => PEOPLE };
  };
  const ids = async (q) => (await getCouncilMember("t", q)).map((p) => p.PersonId);
  assert.deepEqual(await ids("Carmen De La Rosa"), [7806]);
  assert.deepEqual(await ids("Amanda Farias"), [7810]);
  assert.deepEqual(await ids("Althea Stevens"), [7809]);
  assert.deepEqual(await ids("rosa"), [7806, 7870]);
  // Still asks Legistar for active members only.
  assert.equal(new URL(urls[0]).searchParams.get("$filter"), "PersonActiveFlag eq 1");
});

function db() {
  const d = new Database(":memory:");
  d.exec(CREATE_TABLES);
  d.prepare("INSERT INTO bills (matter_id, file_number, title, intro_date, source_json) VALUES (?,?,?,?,?)")
    .run(1, "Res 0001-2026", "A resolution", "2026-01-01", "{}");
  d.prepare("INSERT INTO bills (matter_id, file_number, title, intro_date, source_json) VALUES (?,?,?,?,?)")
    .run(2, "Int 0002-2026", "A local law", "2026-01-02", "{}");
  const person = d.prepare("INSERT INTO people (person_id, full_name, first_name, last_name, active_flag) VALUES (?,?,?,?,1)");
  person.run(7806, "Carmen N. De La Rosa", "Carmen N. ", "De La Rosa");
  person.run(7810, "Amanda C. Farías", "Amanda C.", "Farías");
  person.run(7870, "John LaRosa ", "John", "LaRosa");
  const sponsor = d.prepare("INSERT INTO sponsors (matter_id, person_id) VALUES (?,?)");
  sponsor.run(2, 7806);
  sponsor.run(2, 7810);
  return d;
}

test("get_voting_record (local) matches the typed name too", () => {
  const d = db();
  d.prepare("INSERT INTO votes (event_item_id, person_id, person_name, vote_value, matter_id) VALUES (?,?,?,?,?)")
    .run(10, 7806, "Carmen N. De La Rosa", "Affirmative", 1);
  const rows = getVotingRecord(d, "Carmen De La Rosa");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].file_number, "Res 0001-2026");
  assert.equal(getVotingRecord(d, "John LaRosa").length, 0);
});

test("co_sponsors (local) matches an accent-free name", () => {
  const rows = coSponsors(db(), "Amanda Farias");
  assert.deepEqual(rows.map((r) => r.person_id), [7806]);
});
