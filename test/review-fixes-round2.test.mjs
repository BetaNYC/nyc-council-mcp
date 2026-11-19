// Review fixes for epic #95, round 2. Offline: fetch is stubbed, no token, no real index.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

import { handleLiveTool, handleLiveSearch } from "../dist/tools/live.js";
import { handleLocalTool, LOCAL_TOOL_DEFS } from "../dist/tools/local.js";
import { localToolAnswer, liveToolAnswer, betanycTools } from "../dist/server.js";
import { sourceNote, officialRecord, checkUpcomingLive } from "../dist/tools/local-source.js";
import { CURATED_SOURCE_LINE } from "../dist/tools/member-terms.js";
import { failure } from "../dist/tools/errors.js";
import { CREATE_TABLES } from "../dist/db/schema.js";
import { nyDateString } from "../dist/dates.js";
import { getUpcomingHearingsReport, AGENDA_BUDGET_MS, AGENDA_CONCURRENCY } from "../dist/legistar.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const last = (res) => res.content.at(-1).text;
const DATA_SOURCES = JSON.parse(readFileSync(new URL("../DATA-SOURCES.json", import.meta.url), "utf8"));
const topic = (id) => DATA_SOURCES.sources.find((s) => s.id === id);

// ------------------------------------------------------------------ 1. agenda fan-out in an outage

function event(id) {
  return { EventId: id, EventDate: "2026-11-20T00:00:00", EventBodyName: `Committee ${id}`, EventItems: [] };
}

/** Stub fetch: the meeting list gives n meetings; each agenda request calls agenda(id). */
function stubHearings(n, agenda) {
  const calls = { agenda: [] };
  globalThis.fetch = async (url) => {
    const m = new URL(url).pathname.match(/\/events\/(\d+)\/eventitems$/);
    if (!m) return new Response(JSON.stringify(Array.from({ length: n }, (_, i) => event(i + 1))), { status: 200 });
    const id = Number(m[1]);
    calls.agenda.push(id);
    return agenda(id);
  };
  return calls;
}

test("agendas in an outage: 50 meetings all answering 503 send at most 5 requests, retry none, and return at once", async () => {
  const calls = stubHearings(50, async () => {
    await new Promise((r) => setTimeout(r, 5));
    return new Response("down", { status: 503, headers: { "Retry-After": "1" } });
  });
  const t0 = Date.now();
  const { events, missingAgendas } = await getUpcomingHearingsReport("tok", 14, true);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
  assert.equal(events.length, 50);
  assert.equal(calls.agenda.length, AGENDA_CONCURRENCY, "only the requests already in flight");
  assert.equal(new Set(calls.agenda).size, calls.agenda.length, "no 503 was retried");
  assert.equal(missingAgendas.length, 50);
  assert.equal(missingAgendas.filter((m) => /^The Legistar API answered HTTP 503/.test(m.reason)).length, 5);
  assert.equal(missingAgendas.filter((m) => m.reason === "not requested, because an earlier agenda request failed").length, 45);
});

test("agendas: a non-429 failure is listed with its reason, and no request starts after it", async () => {
  // Meeting 3 fails with a 500; 1-5 were already in flight; 6-12 are never requested.
  const calls = stubHearings(12, async (id) => {
    await new Promise((r) => setTimeout(r, id === 3 ? 1 : 10));
    return id === 3 ? new Response("oops", { status: 500 }) : new Response(JSON.stringify([{ EventItemId: id }]), { status: 200 });
  });
  const { events, missingAgendas } = await getUpcomingHearingsReport("tok", 14, true);
  assert.deepEqual(calls.agenda.sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  const missing = new Map(missingAgendas.map((m) => [m.EventId, m.reason]));
  assert.match(missing.get(3), /^The Legistar API answered HTTP 500/, "the failed meeting is in the missing list");
  assert.deepEqual([...missing.keys()].sort((a, b) => a - b), [3, 6, 7, 8, 9, 10, 11, 12]);
  for (const id of [6, 12]) assert.equal(missing.get(id), "not requested, because an earlier agenda request failed");
  assert.equal(events.find((e) => e.EventId === 2).EventItems.length, 1, "agendas already fetched are kept");
});

test("agendas share a 20-second budget (fake clock): when it runs out, the rest are 'out of time'", async () => {
  assert.equal(AGENDA_BUDGET_MS, 20_000);
  let now = 1_000_000;
  // Every agenda request takes 3 fake seconds.
  const calls = stubHearings(12, () => {
    now += 3000;
    return new Response("[]", { status: 200 });
  });
  const { events, missingAgendas } = await getUpcomingHearingsReport("tok", 14, true, { clock: () => now });
  // Requests start at 0, 3, 6, 9, 12, 15 and 18 seconds; at 21 the budget is spent.
  assert.equal(calls.agenda.length, 7);
  assert.equal(missingAgendas.length, 5);
  for (const m of missingAgendas) {
    assert.equal(m.reason, "out of time: the agendas get 20 seconds in all");
    assert.ok(!calls.agenda.includes(m.EventId));
    assert.equal(events.find((e) => e.EventId === m.EventId).EventItems, null);
  }
});

test("agendas: a request cut off by the budget is 'out of time', and nothing is sent after it", async () => {
  let now = 0;
  const calls = stubHearings(3, () => {
    now += 25_000;
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });
  const { missingAgendas } = await getUpcomingHearingsReport("tok", 14, true, { clock: () => now });
  assert.equal(calls.agenda.length, 1);
  assert.deepEqual(missingAgendas.map((m) => m.reason), Array(3).fill("out of time: the agendas get 20 seconds in all"));
});

// ------------------------------------------------------------------ 2. a missing agenda is null

test("get_upcoming_hearings: a meeting whose agenda failed has EventItems null in both shapes, and the note says so", async () => {
  stubHearings(2, (id) => (id === 2 ? new Response("", { status: 502 }) : new Response("[]", { status: 200 })));
  for (const detail of ["summary", "full"]) {
    const res = await handleLiveTool("get_upcoming_hearings", { detail }, "tok");
    const out = JSON.parse(res.content[0].text);
    assert.deepEqual(out.find((e) => e.EventId === 1).EventItems, [], `${detail}: fetched and empty is []`);
    assert.ok("EventItems" in out.find((e) => e.EventId === 2), detail);
    assert.equal(out.find((e) => e.EventId === 2).EventItems, null, `${detail}: not fetched is null`);
    assert.match(res.content[1].text, /EventItems are null \(not fetched; this does not mean the agenda is empty\): 2 /);
  }
});

// ------------------------------------------------------------------ 3. every list lowers a too-big limit

test("search_legislation_live lowers a limit over 50 to 50 and says so", async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(new URL(url));
    return new Response(JSON.stringify(Array.from({ length: 60 }, (_, i) => ({ MatterId: i + 1 }))), { status: 200 });
  };
  const res = await handleLiveSearch({ query: "x", limit: 51 }, "tok");
  assert.ok(!res.isError, res.content[0].text);
  assert.equal(urls[0].searchParams.get("$top"), "51");
  assert.equal(JSON.parse(res.content[0].text).length, 50);
  assert.match(res.content[1].text, /^limit 51 is over this tool's maximum of 50, so 50 was used\. Showing the first 50 results; more are available\./);
  for (const bad of [0, 2.5]) assert.equal((await handleLiveSearch({ query: "x", limit: bad }, "tok")).isError, true);
});

// ------------------------------------------------------------------ 4. local answers say BetaNYC modified the data

function indexDb(state = { last_indexed_at: "2026-11-12T11:30:07.125Z", archive_commit: "9e52935", archive_commit_date: "2026-11-11T23:38:10Z" }) {
  const db = new Database(":memory:");
  db.exec(CREATE_TABLES);
  const put = db.prepare("INSERT OR REPLACE INTO index_state (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(state)) put.run(k, v);
  return db;
}

test("the local source line says BetaNYC modified the data, as about_data does, and names the mirror and the official record", () => {
  const line = sourceNote(indexDb(), { hasLive: true, empty: false, tool: "get_matter" }, new Date("2026-11-18T12:00:00Z"));
  assert.equal(
    line,
    "BetaNYC modified this data: it built this local index from jehiah/nyc_legislation@9e52935 (archive commit 2026-11-11T23:38:10Z), " +
      "an unofficial mirror of the Council's Legistar records; the build trims committee names and role titles, leaves out rows with no ID, " +
      "and cuts dates to the day (history dates keep their New York time and lose a trailing Z); about_data lists every change. " +
      "This copy should not be considered the official record. As of 2026-11-12T11:30:07.125Z (the date of the copy this server answers from). " +
      "Official record: NYC Council Legistar: Legislation, https://legistar.council.nyc.gov/Legislation.aspx"
  );
  const about = betanycTools({ db: null, hasLive: false, version: "0.0.0" }).call("about_data", { topic: "bills" });
  assert.match(about.content[0].text, /^BetaNYC modified this data: /m);
});

test("each local tool's official record is the DATA-SOURCES.json source that lists the tool", () => {
  for (const t of LOCAL_TOOL_DEFS) {
    const { sourceName, sourceUrl } = officialRecord(t.name);
    const s = DATA_SOURCES.sources.find((x) => x.tools.includes(t.name) && x.source_name === sourceName && x.source_url === sourceUrl);
    assert.ok(s, `${t.name}: ${sourceName}, ${sourceUrl}`);
  }
});

// ------------------------------------------------------------------ 5. about_data says what the build changes

test("about_data names each change the index build makes; the districts credit no longer says 'used as published'", () => {
  for (const id of ["bills", "votes", "events", "committees", "districts"]) {
    assert.doesNotMatch(topic(id).changes.detail, /values unchanged|used as published/, id);
    assert.ok(topic(id).changes.steps.includes("cleaned") && topic(id).changes.steps.includes("filtered"), id);
  }
  assert.match(topic("bills").changes.detail, /history dates lose their trailing Z/);
  assert.match(topic("bills").changes.detail, /cut to the day/);
  assert.match(topic("bills").changes.detail, /sponsors and attachments with no ID are left out/);
  assert.match(topic("votes").changes.detail, /a vote with no person ID is left out/);
  assert.match(topic("events").changes.detail, /agenda items with no ID are left out/);
  assert.match(topic("committees").changes.detail, /committee names, role titles and member types are trimmed/);
  assert.match(topic("committees").changes.detail, /office records with no ID or no committee name/);
  assert.match(topic("districts").changes.detail, /a district that is not a number is left blank \(null\)/);
  assert.match(topic("districts").changes.detail, /term start and end dates are cut to the day/);
  assert.doesNotMatch(topic("districts").terms.credit_line, /used as published/);
});

// ------------------------------------------------------------------ 6. upcoming_events in hybrid mode

function eventsDb() {
  const db = indexDb();
  db.prepare("INSERT INTO events (event_id, date, body_name, agenda_status, source_json) VALUES (1, ?, 'Committee on Health', 'Final', '{}')").run(nyDateString());
  return db;
}

function stubStatuses(rows) {
  globalThis.fetch = async () => new Response(JSON.stringify(rows), { status: 200 });
}

test("hybrid upcoming_events: the source line names the index and the live API, with the live fetch time", async () => {
  stubStatuses([{ EventId: 1, EventDate: `${nyDateString()}T00:00:00`, EventAgendaStatusName: "Deferred", EventBodyName: "Committee on Health" }]);
  const res = await localToolAnswer("upcoming_events", {}, eventsDb(), "tok");
  assert.ok(!res.isError, res.content[0].text);
  const row = JSON.parse(res.content[0].text)[0];
  assert.equal(row.agenda_status, "Deferred");
  assert.equal(row.agenda_status_index, "Final");
  const lines = last(res).split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^BetaNYC modified this data: /);
  assert.match(
    lines[1],
    /^agenda_status is the live Legistar value, not the index's \(the index's value is kept in agenda_status_index where they differ\)\. Source: NYC Council Legistar Web API \(Granicus\)\. Fetched from the source for this answer at \d{4}-\d{2}-\d{2} \d{2}:\d{2} E[SD]T \(New York time\)\. Link: https:\/\/legistar\.council\.nyc\.gov\/Calendar\.aspx$/
  );
});

test("hybrid upcoming_events: when the live check fails, the source line names only the index", async () => {
  globalThis.fetch = async () => new Response("down", { status: 404 });
  const res = await localToolAnswer("upcoming_events", {}, eventsDb(), "tok");
  assert.ok(!res.isError);
  assert.match(res.content.at(-2).text, /^Agenda status could not be checked against the live API/);
  assert.equal(last(res).split("\n").length, 1);
});

// ------------------------------------------------------------------ 7. search_legislation's own method

test("search_legislation says its order and agency filter are BetaNYC's, on the answer and in about_data", () => {
  const db = indexDb();
  db.prepare("INSERT INTO bills (matter_id, file_number, title, sponsor_names, source_json) VALUES (1, 'Int 0001-2026', 'A Local Law about the police department', '', '{}')").run();
  db.prepare("INSERT INTO bills_fts (rowid, file_number, title) SELECT rowid, file_number, title FROM bills").run();
  const plain = handleLocalTool("search_legislation", { query: "police" }, db);
  assert.match(last(plain), /^Order: /);
  assert.doesNotMatch(last(plain), /Agency filter/);
  const withAgency = handleLocalTool("search_legislation", { query: "police", agency: "NYPD" }, db);
  assert.equal(JSON.parse(withAgency.content[0].text).length, 1);
  assert.match(last(withAgency), /Agency filter: BetaNYC's own phrase list for each agency \(src\/agencies\.ts\), matched in the title or sponsors; it is not an official classification\.$/);
  assert.match(topic("bills").changes.detail, /BetaNYC's own weights/);
  assert.match(topic("bills").changes.detail, /BetaNYC's own list for that agency \(src\/agencies\.ts/);
});

// ------------------------------------------------------------------ 8. error paths

const STACK = "\n    at Object.<anonymous> (/Users/someone/secret/path.js:1:2)\n    at node:internal/main:3:4";

test("checkUpcomingLive: a failed live check gives one plain line, with no stack and no token", async () => {
  const res = { content: [{ type: "text", text: "[]" }] };
  const out = await checkUpcomingLive(res, 14, async () => { throw new Error(`socket hang up T0K3N-12345${STACK}`); }, undefined, "T0K3N-12345");
  const note = out.content[1].text;
  assert.equal(note, "Agenda status could not be checked against the live API (socket hang up [redacted]); it is the index's.");
});

test("a throw in upcoming_events' SQL after the tool ran is a plain isError answer", async () => {
  stubStatuses([{ EventId: 999, EventDate: `${nyDateString()}T00:00:00`, EventAgendaStatusName: "Final", EventBodyName: "X" }]);
  const real = eventsDb();
  const db = new Proxy(real, {
    get(t, k) {
      if (k === "prepare") return (sql) => { if (sql.includes("json_each")) throw new Error(`no such function: json_each${STACK}`); return t.prepare(sql); };
      const v = t[k];
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  const res = await localToolAnswer("upcoming_events", {}, db, "tok");
  assert.equal(res.isError, true);
  assert.equal(res.content[0].text, "Error: no such function: json_each");
});

test("a throw while adding the source line is a plain isError answer", async () => {
  // A line break in the stored commit makes provenance() throw.
  const db = indexDb({ last_indexed_at: "2026-11-12T11:30:07.125Z", archive_commit: "9e52935\nX" });
  const res = await localToolAnswer("list_committees", {}, db, null);
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /^Error: provenance: changedByBetanyc\.detail has a control, format or line-break character$/);
});

test("a throw in councilMemberAnswer (curated, terms, sources) is a plain isError answer", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify([{ PersonId: 5259, PersonFullName: "Gale A. Brewer", PersonActiveFlag: 1 }]), { status: 200 });
  const db = { prepare() { throw new Error(`database is locked${STACK}`); } };
  const res = await liveToolAnswer("get_council_member", { name: "Brewer" }, "tok", db);
  assert.equal(res.isError, true);
  assert.equal(res.content[0].text, "Error: database is locked");
});

// ------------------------------------------------------------------ 9. tests for the mutations that survived review

test("get_member_roles' answer itself (not only its description) says the curated block is BetaNYC's", () => {
  const lines = sourceNote(indexDb(), { hasLive: true, empty: false, tool: "get_member_roles" }).split("\n");
  assert.ok(lines.includes(CURATED_SOURCE_LINE), lines.join("\n"));
  assert.match(CURATED_SOURCE_LINE, /not an official record/);
  assert.ok(!sourceNote(indexDb(), { hasLive: true, empty: false, tool: "committee_roster" }).includes(CURATED_SOURCE_LINE));
});

test("errors.ts passes only the first plain line of an unexpected error", () => {
  const res = failure(new Error("first line\nsecond line with more detail"), "get_matter", LOCAL_TOOL_DEFS);
  assert.equal(res.content[0].text, "Error: first line");
});
