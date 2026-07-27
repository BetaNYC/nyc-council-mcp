// Acceptance test for issue #30: indexing each matter's History[] into the
// `votes` and `matter_history` tables, and answering roll-call / bill-history
// questions from the local corpus.
//
// This exercises the REAL buildIndex over a temp fixture archive (the seam from
// indexer.mattertypes.test.mjs) and asserts what the QUERY FUNCTIONS return —
// external behavior, not the traversal's internals. The fixture mirrors real
// archive shapes verified 2026-07-24 against resolution/2026/0540.json:
//   History[] entries carry {ID, Action, Date, BodyName, EventID, PassedFlag,
//   PassedFlagName, Votes}, and each Votes[] entry {ID(=person_id), Slug,
//   FullName, VoteID, Vote, Result, Sort}.
//
// The golden anchor is Res 0540-2026 (the adopted FY2027 contract budget), whose
// real roll calls are: Council 45 Affirmative / 6 Negative (51 recorded) and
// Committee on Finance 14 Affirmative / 1 Negative / 2 Absent (17 recorded). The
// six Council negatives are Ariola, Carr, Morano, Paladino, Stevens, Vernikov.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { buildIndex } from "../dist/db/indexer.js";
import { voteBreakdown, getVotingRecord, getBillHistoryLocal } from "../dist/db/queries.js";

// --- fixture builders -------------------------------------------------------

// A member entry in a roll call. VoteID (a value-id) is irrelevant to indexing —
// the code reads Vote (the value string) and ID (the person_id) — but included
// so the fixture mirrors the real shape rather than a stripped guess.
function vote(id, fullName, value, sort) {
  return {
    ID: id,
    Slug: `p-${id}`,
    FullName: fullName,
    VoteID: value === "Affirmative" ? 15 : 16,
    Vote: value,
    Result: value === "Affirmative" ? 1 : 0,
    Sort: sort,
  };
}

// The six real Council negatives on Res 0540-2026. Morano (9001) also votes
// Negative in committee, so one person_id spans two roll calls of one matter —
// exactly why the votes PK is (event_item_id, person_id), not person_id alone.
const NEGATIVES = [
  [9001, "Frank Morano"],
  [9002, "Joann Ariola"],
  [9003, "David M. Carr"],
  [9004, "Vickie Paladino"],
  [9005, "Althea V. Stevens"],
  [9006, "Inna Vernikov"],
];

function res0540History() {
  // Council roll call (event_item_id 440128): 45 Affirmative + 6 Negative = 51.
  const council = [];
  for (let i = 0; i < 45; i++) council.push(vote(9100 + i, `Aff Member ${9100 + i}`, "Affirmative", i));
  for (const [id, name] of NEGATIVES) council.push(vote(id, name, "Negative", 200 + id));

  // Committee roll call (event_item_id 440111): 14 Affirmative + 1 Negative
  // (Morano) + 2 Absent = 17 recorded, but a tally of only 14–1 = 15 positions.
  // The 2 absentees are Council affirmatives too — a member present for the
  // Council vote but absent from committee.
  const committee = [];
  for (let i = 0; i < 14; i++) committee.push(vote(9100 + i, `Aff Member ${9100 + i}`, "Affirmative", i));
  committee.push(vote(9001, "Frank Morano", "Negative", 60));
  committee.push(vote(9114, "Aff Member 9114", "Absent", 70));
  committee.push(vote(9115, "Aff Member 9115", "Absent", 71));

  // Four actions in file (chronological) order; two carry no Votes.
  return [
    { ID: 440082, Action: "Hearing on P-C Item by Comm", Date: "2026-06-30T15:30:00Z", BodyName: "Committee on Finance", EventID: 22597, MatterStatusID: 40 },
    { ID: 440111, Action: "P-C Item Approved by Comm", Date: "2026-06-30T15:30:00Z", BodyName: "Committee on Finance", EventID: 22597, PassedFlag: 1, PassedFlagName: "Pass", Votes: committee },
    { ID: 439914, Action: "Introduced by Council", Date: "2026-06-30T17:00:00Z", BodyName: "City Council", EventID: 22592 },
    { ID: 440128, Action: "Approved, by Council", Date: "2026-06-30T17:05:00Z", BodyName: "City Council", EventID: 22592, PassedFlag: 1, PassedFlagName: "Pass", Votes: council },
  ];
}

function matterJson(id, file, typeName, title, year, history) {
  return JSON.stringify({
    ID: id,
    File: file,
    Name: file,
    Title: title,
    TypeName: typeName,
    StatusName: "Adopted",
    BodyName: "City Council",
    IntroDate: `${year}-06-30T00:00:00`,
    Sponsors: [{ ID: 8000 + (id % 1000), FullName: "Prime Sponsor", Slug: "prime" }],
    History: history,
  });
}

function affRollCall(eventItemId, startPersonId, n, body, date) {
  const votes = [];
  for (let i = 0; i < n; i++) votes.push(vote(startPersonId + i, `Member ${startPersonId + i}`, "Affirmative", i));
  return { ID: eventItemId, Action: "Approved", Date: date, BodyName: body, EventID: eventItemId + 1, PassedFlag: 1, PassedFlagName: "Pass", Votes: votes };
}

function buildArchive() {
  const root = mkdtempSync(join(tmpdir(), "legistar-history-"));
  const write = (rel, contents) => {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, contents);
  };

  // The golden anchor.
  write("resolution/2026/0540.json", matterJson(79146, "Res 0540-2026", "Resolution", "FY2027 Contract Budget", 2026, res0540History()));

  // A matter with History actions but NO Votes (most matters look like this).
  write(
    "introduction/2024/0002.json",
    matterJson(2, "Int 0002-2024", "Introduction", "A Local Law with no roll call", 2024, [
      { ID: 500001, Action: "Introduced by Council", Date: "2024-01-10T10:00:00Z", BodyName: "City Council", EventID: 30001 },
      { ID: 500002, Action: "Referred to Comm by Council", Date: "2024-01-10T10:05:00Z", BodyName: "City Council", EventID: 30001 },
    ])
  );

  // A Land Use matter with a roll call — the densest vote source, indexed from
  // the land_use tree, not special-cased.
  write(
    "land_use/2021/0946.json",
    matterJson(300, "LU 0946-2021", "Land Use Application", "A rezoning", 2021, [
      affRollCall(375414, 9300, 5, "Subcommittee on Landmarks, Public Sitings and Dispositions", "2021-05-01T12:00:00Z"),
    ])
  );

  // An Int and a Res sharing one bare number, with DIFFERENT roll calls, so
  // disambiguation is observable (bare number errors; prefixed returns distinct).
  write(
    "introduction/2025/0700.json",
    matterJson(7001, "Int 0700-2025", "Introduction", "Int sharing a number", 2025, [
      affRollCall(600001, 9400, 3, "City Council", "2025-03-01T10:00:00Z"),
    ])
  );
  write(
    "resolution/2025/0700.json",
    matterJson(7002, "Res 0700-2025", "Resolution", "Res sharing a number", 2025, [
      { ID: 600003, Action: "Approved, by Council", Date: "2025-03-01T11:00:00Z", BodyName: "City Council", EventID: 600004, PassedFlag: 1, PassedFlagName: "Pass",
        Votes: [
          ...[0, 1, 2, 3, 4].map((i) => vote(9500 + i, `Member ${9500 + i}`, "Affirmative", i)),
          vote(9599, "Lone Dissenter", "Negative", 9),
          // Abstain is a POSITION (counts toward the tally); Medical is a
          // non-position (stored, but excluded from the tally).
          vote(9598, "Abstainer", "Abstain", 10),
          vote(9597, "On Leave", "Medical", 11),
        ] },
    ])
  );

  return root;
}

// --- shared fixture (built once) --------------------------------------------

let archiveRoot;
let dbPath;
let firstStats;

before(async () => {
  archiveRoot = buildArchive();
  dbPath = join(archiveRoot, "index.db");
  firstStats = await buildIndex({ archiveRoot, dbPath, full: true });
});

after(() => rmSync(archiveRoot, { recursive: true, force: true }));

function openRo() {
  return new Database(dbPath, { readonly: true });
}

// --- tests ------------------------------------------------------------------

test("buildIndex populates votes and matter_history from all three matter trees", () => {
  // Stats reflect the fixture exactly: 5 matters, 9 history actions,
  // 68 (Res0540) + 0 (Int0002) + 5 (LU) + 3 (Int0700) + 8 (Res0700) = 84 votes.
  assert.equal(firstStats.bills, 5, "five matters across three trees");
  assert.equal(firstStats.matterHistory, 9, "one row per History action");
  assert.equal(firstStats.votes, 84, "one row per roll-call entry");
});

test("golden fixture: vote_breakdown('Res 0540-2026') returns the real roll calls", () => {
  const db = openRo();
  try {
    const bd = voteBreakdown(db, "Res 0540-2026");
    assert.equal(bd.matter_id, 79146);
    assert.equal(bd.roll_calls.length, 2, "committee + Council roll calls");

    const council = bd.roll_calls.find((rc) => rc.event_item_id === 440128);
    const committee = bd.roll_calls.find((rc) => rc.event_item_id === 440111);
    assert.ok(council && committee, "both roll calls present");

    // Council: 45 Affirmative, 6 Negative, 51 recorded.
    assert.equal(council.body_name, "City Council");
    assert.equal(council.recorded, 51);
    assert.equal(council.votes.length, 51);
    assert.deepEqual(council.tally, { affirmative: 45, negative: 6, abstain: 0 });

    // The six named negatives, exactly.
    const negNames = council.votes.filter((v) => v.vote_value === "Negative").map((v) => v.person_name).sort();
    assert.deepEqual(negNames, [
      "Althea V. Stevens", "David M. Carr", "Frank Morano", "Inna Vernikov", "Joann Ariola", "Vickie Paladino",
    ]);

    // Committee: 14 Affirmative, 1 Negative, 2 Absent — 17 recorded.
    assert.equal(committee.body_name, "Committee on Finance");
    assert.equal(committee.recorded, 17);
    assert.deepEqual(committee.tally, { affirmative: 14, negative: 1, abstain: 0 });

    // Every vote row carries the fields the acceptance criteria name.
    for (const v of council.votes) {
      assert.equal(typeof v.person_id, "number");
      assert.equal(typeof v.person_name, "string");
      assert.equal(v.event_item_id, 440128);
      assert.equal(v.matter_id, 79146);
    }
  } finally {
    db.close();
  }
});

test("a tally counts positions only — the committee roll call is 14–1, not 17", () => {
  const db = openRo();
  try {
    const committee = voteBreakdown(db, "Res 0540-2026").roll_calls.find((rc) => rc.event_item_id === 440111);
    const positions = committee.tally.affirmative + committee.tally.negative + committee.tally.abstain;
    assert.equal(positions, 15, "14 Affirmative + 1 Negative = 15 positions");
    assert.notEqual(positions, committee.recorded, "a tally is never COUNT(*) of the roll call (17)");
    // Non-positions are retained, not discarded.
    const absent = committee.votes.filter((v) => v.vote_value === "Absent");
    assert.equal(absent.length, 2, "the two Absent entries are stored faithfully");
  } finally {
    db.close();
  }
});

test("a matter with History but no Votes yields matter_history rows and zero vote rows", () => {
  const db = openRo();
  try {
    const hist = getBillHistoryLocal(db, "Int 0002-2024");
    assert.equal(hist.matter_id, 2);
    assert.equal(hist.history.length, 2, "both vote-less actions are recorded");

    const voteCount = db.prepare("SELECT COUNT(*) AS n FROM votes WHERE matter_id = 2").get().n;
    assert.equal(voteCount, 0, "no roll call → no vote rows");

    const bd = voteBreakdown(db, "Int 0002-2024");
    assert.equal(bd.roll_calls.length, 0, "vote_breakdown returns no roll calls, not an error");
  } finally {
    db.close();
  }
});

test("get_bill_history (local) is chronological and carries body/outcome, no token", () => {
  const db = openRo();
  try {
    const h = getBillHistoryLocal(db, "Res 0540-2026");
    assert.equal(h.history.length, 4);

    const dates = h.history.map((r) => r.action_date);
    assert.deepEqual(dates, [...dates].sort(), "actions are ordered oldest-first");

    const approved = h.history.find((r) => r.event_item_id === 440128);
    assert.equal(approved.action_name, "Approved, by Council");
    assert.equal(approved.body_name, "City Council");
    assert.equal(approved.passed_flag, "Pass");

    const hearing = h.history.find((r) => r.event_item_id === 440082);
    assert.equal(hearing.passed_flag, null, "a procedural action carries no passed flag");
  } finally {
    db.close();
  }
});

test("get_voting_record joins on matter_id and returns a member's votes", () => {
  const db = openRo();
  try {
    // Morano voted in BOTH the committee and Council roll calls of Res 0540-2026.
    const rows = getVotingRecord(db, "Frank Morano");
    assert.equal(rows.length, 2, "one row per roll call the member appears in");
    for (const r of rows) {
      assert.equal(r.file_number, "Res 0540-2026");
      assert.equal(r.vote_value, "Negative");
    }
  } finally {
    db.close();
  }
});

test("Land Use roll calls are indexed (density), not silently dropped", () => {
  const db = openRo();
  try {
    const lu = voteBreakdown(db, "LU 0946-2021");
    assert.equal(lu.roll_calls.length, 1);
    assert.equal(lu.roll_calls[0].tally.affirmative, 5);

    const bill = db.prepare("SELECT type_name FROM bills WHERE file_number = 'LU 0946-2021'").get();
    assert.equal(bill.type_name, "Land Use Application", "votes came from the land_use tree");
  } finally {
    db.close();
  }
});

test("vote_breakdown disambiguates Int from Res sharing a number", () => {
  const db = openRo();
  try {
    // Bare number → error naming BOTH matters, never one silently.
    assert.throws(() => voteBreakdown(db, "0700-2025"), (err) => {
      assert.match(err.message, /ambiguous/i);
      assert.match(err.message, /Int 0700-2025/);
      assert.match(err.message, /Res 0700-2025/);
      return true;
    });
    // get_bill_history disambiguates identically.
    assert.throws(() => getBillHistoryLocal(db, "0700-2025"), /ambiguous/i);

    // Prefixed → distinct results.
    const intBd = voteBreakdown(db, "Int 0700-2025");
    const resBd = voteBreakdown(db, "Res 0700-2025");
    assert.notEqual(intBd.matter_id, resBd.matter_id);
    assert.deepEqual(intBd.roll_calls[0].tally, { affirmative: 3, negative: 0, abstain: 0 });
    // Res 0700 has Affirmative×5, Negative, Abstain, Medical (8 recorded). Abstain
    // counts as a position; Medical is stored but excluded → tally 5-1-1 across 8.
    assert.deepEqual(resBd.roll_calls[0].tally, { affirmative: 5, negative: 1, abstain: 1 });
    assert.equal(resBd.roll_calls[0].recorded, 8, "non-position Medical is recorded, not dropped");
    assert.ok(resBd.roll_calls[0].votes.some((v) => v.vote_value === "Medical"), "the Medical entry round-trips intact");
  } finally {
    db.close();
  }
});

test("vote_breakdown answers while every event_items.file_number is NULL (no #26 dependency)", () => {
  const db = openRo();
  try {
    const linked = db.prepare("SELECT COUNT(*) AS n FROM event_items WHERE file_number IS NOT NULL").get().n;
    assert.equal(linked, 0, "the fixture has no event_items linkage at all");

    const council = voteBreakdown(db, "Res 0540-2026").roll_calls.find((rc) => rc.event_item_id === 440128);
    assert.equal(council.recorded, 51, "roll call answered from votes⋈matter_history, not event_items");
  } finally {
    db.close();
  }
});

test("re-indexing is idempotent — a second full build changes no row counts", async () => {
  const before = tableCounts();
  const stats = await buildIndex({ archiveRoot, dbPath, full: true });
  assert.deepEqual(tableCounts(), before, "row counts are stable across rebuilds");
  assert.equal(stats.votes, 84, "the same 84 vote rows, not doubled");
  assert.equal(stats.matterHistory, 9);
});

function tableCounts() {
  const db = openRo();
  try {
    return {
      bills: db.prepare("SELECT COUNT(*) AS n FROM bills").get().n,
      votes: db.prepare("SELECT COUNT(*) AS n FROM votes").get().n,
      matter_history: db.prepare("SELECT COUNT(*) AS n FROM matter_history").get().n,
    };
  } finally {
    db.close();
  }
}
