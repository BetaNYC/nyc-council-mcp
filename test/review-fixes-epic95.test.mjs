// Review fixes for epic #95. Offline: fetch is stubbed, no token, no real index.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { handleLiveTool, liveSourceLine, LIVE_TOOL_DEFS } from "../dist/tools/live.js";
import { LOCAL_TOOL_DEFS } from "../dist/tools/local.js";
import { betanycTools, councilMemberAnswer } from "../dist/server.js";
import { CURATED_SOURCE_LINE } from "../dist/tools/member-terms.js";
import { SOURCE_LINK, LIVE_SOURCE } from "../dist/tools/source-links.js";
import { CREATE_TABLES } from "../dist/db/schema.js";
import {
  legistarFetch, getUpcomingHearingsReport, LegistarError, AGENDA_CONCURRENCY, COUNCIL_MEMBER_MAX,
} from "../dist/legistar.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const last = (res) => res.content.at(-1).text;
const URL_ = "https://webapi.legistar.com/v1/nyc/matters?token=T0K3N";

// ------------------------------------------------------------------ 1. get_council_member sources

const BREWER = { PersonId: 5259, PersonFullName: "Gale A. Brewer", PersonActiveFlag: 1 };

function termsDb(fetchedAt = "2026-11-13T02:13:52Z") {
  const db = new Database(":memory:");
  db.exec(CREATE_TABLES);
  db.prepare("INSERT INTO member_terms (office_id, person_id, name, district, term_start, term_end) VALUES (5805, 5259, 'Gale A. Brewer', 6, '2026-01-01', '2029-12-31')").run();
  if (fetchedAt) db.prepare("INSERT INTO index_state (key, value) VALUES ('member_terms_fetched_at', ?)").run(fetchedAt);
  return db;
}

test("hybrid get_council_member: the source line names Legistar, the terms file with its fetch date, and the curated block", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify([BREWER]), { status: 200 });
  const res = councilMemberAnswer(await handleLiveTool("get_council_member", { name: "Brewer" }, "tok"), termsDb());
  assert.ok(!res.isError);
  const person = JSON.parse(res.content[0].text)[0];
  assert.equal(person.district, 6, "terms were added");
  assert.ok(person.curated, "curated block was added");
  const lines = last(res).split("\n");
  assert.equal(lines.length, 3, last(res));
  assert.match(lines[0], /^Source: NYC Council Legistar Web API \(Granicus\), a copy BetaNYC modified/);
  assert.ok(lines[0].endsWith(`Link: ${SOURCE_LINK.get_council_member}`));
  assert.equal(
    lines[1],
    "District and terms: City Council Members (1999 to Present), New York City Council, NYC Open Data uvw5-9znb; " +
      "a copy shipped with this server (fetched 2026-11-13T02:13:52Z), which BetaNYC joined to Legistar members by person ID " +
      "(a district that is not a number is left blank, and term dates are cut to the day). " +
      "Link: https://data.cityofnewyork.us/d/uvw5-9znb"
  );
  assert.equal(lines[2], CURATED_SOURCE_LINE);
  assert.match(lines[2], /BetaNYC's .*not an official record/);
});

test("get_council_member: an unknown terms fetch date stays unknown; live-only mode names the curated block only", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify([BREWER]), { status: 200 });
  const noDate = councilMemberAnswer(await handleLiveTool("get_council_member", { name: "Brewer" }, "tok"), termsDb(null));
  assert.match(last(noDate), /a copy shipped with this server \(fetch date unknown\)/);
  const liveOnly = councilMemberAnswer(await handleLiveTool("get_council_member", { name: "Brewer" }, "tok"), null);
  const lines = last(liveOnly).split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Source: NYC Council Legistar Web API/);
  assert.equal(lines[1], CURATED_SOURCE_LINE);
});

// ------------------------------------------------------------------ 2. live source line vs about_data

test("the live source line says BetaNYC modified the copy, as about_data does, and that Legistar is the official record", () => {
  const res = betanycTools({ db: null, hasLive: true, version: "0.0.0" }).call("about_data", { topic: "live" });
  const s = res.structuredContent.sources[0];
  assert.equal(s.figures_official, false, "about_data: the live copy is not the official record");
  assert.match(res.content[0].text, /^BetaNYC modified this data: /m);
  assert.equal(s.changed_by_betanyc.changed, true);
  assert.match(s.changed_by_betanyc.detail, /profile links .* corrected/);
  assert.match(s.changed_by_betanyc.detail, /cut item titles longer than 300 characters/);

  const line = liveSourceLine("get_bill");
  assert.ok(line.startsWith(`Source: ${s.source}, a copy BetaNYC modified (`), line);
  assert.match(line, /fixes known-bad member profile links and shortens long hearing titles\); Legistar is the official record\./);
  assert.equal(s.source, LIVE_SOURCE.sourceName);
});

// ------------------------------------------------------------------ 3. agenda fan-out

function event(id) {
  return { EventId: id, EventDate: "2026-11-20T00:00:00", EventBodyName: `Committee ${id}`, EventItems: [] };
}

function stubHearings(n, agenda) {
  const calls = { events: 0, agenda: [], inflight: 0, peak: 0 };
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const m = u.pathname.match(/\/events\/(\d+)\/eventitems$/);
    if (!m) {
      calls.events++;
      return new Response(JSON.stringify(Array.from({ length: n }, (_, i) => event(i + 1))), { status: 200 });
    }
    const id = Number(m[1]);
    calls.agenda.push(id);
    calls.inflight++;
    calls.peak = Math.max(calls.peak, calls.inflight);
    try {
      await new Promise((r) => setTimeout(r, 5));
      return agenda(id);
    } finally {
      calls.inflight--;
    }
  };
  return calls;
}

test("agendas: at most AGENDA_CONCURRENCY (5) requests in flight, one per meeting", async () => {
  assert.equal(AGENDA_CONCURRENCY, 5);
  const calls = stubHearings(50, () => new Response("[]", { status: 200 }));
  const { events, missingAgendas } = await getUpcomingHearingsReport("tok", 14, true);
  assert.equal(events.length, 50);
  assert.equal(calls.agenda.length, 50);
  assert.equal(new Set(calls.agenda).size, 50);
  assert.ok(calls.peak <= 5, `peak ${calls.peak}`);
  assert.equal(calls.peak, 5);
  assert.deepEqual(missingAgendas, []);
});

test("agendas: a 429 is not retried, no more agenda requests are sent, and the missing ones are named", async () => {
  // Every agenda request is refused: only the first 5 are sent (all in flight at once), none twice.
  const calls = stubHearings(50, () => new Response("slow down", { status: 429, headers: { "Retry-After": "1" } }));
  const { events, missingAgendas } = await getUpcomingHearingsReport("tok", 14, true);
  assert.equal(events.length, 50);
  assert.equal(calls.agenda.length, 5, "a burst of 50 stays at 5 requests");
  assert.equal(new Set(calls.agenda).size, 5, "no 429 was retried");
  assert.equal(missingAgendas.length, 50);
  assert.equal(missingAgendas.filter((m) => /^Legistar answered HTTP 429/.test(m.reason)).length, 5);
  assert.equal(missingAgendas.filter((m) => /^not requested, because Legistar answered HTTP 429/.test(m.reason)).length, 45);
});

test("agendas: after one 429 the meetings already fetched keep their agenda; get_upcoming_hearings says which are missing", async () => {
  const calls = stubHearings(12, (id) =>
    id === 1 ? new Response("", { status: 429 }) : new Response(JSON.stringify([{ EventItemId: id * 10, EventItemTitle: "x" }]), { status: 200 })
  );
  const res = await handleLiveTool("get_upcoming_hearings", {}, "tok");
  assert.ok(!res.isError);
  assert.deepEqual(calls.agenda, [1, 2, 3, 4, 5], "requests 2-5 were in flight; nothing started after the 429");
  const out = JSON.parse(res.content[0].text);
  assert.equal(out.find((e) => e.EventId === 2).EventItems.length, 1);
  assert.equal(out.find((e) => e.EventId === 6).EventItems, null, "not fetched: null (unknown), not [] (round 2, fix 2)");
  assert.equal(out.find((e) => e.EventId === 1).EventItems, null);
  assert.equal(res.content.length, 3, "JSON, the missing-agenda note, the source line");
  assert.match(res.content[1].text, /^The agenda is missing for 8 of 12 meetings, so their EventItems are null \(not fetched; this does not mean the agenda is empty\): 1 \(2026-11-20, Committee 1\): Legistar answered HTTP 429 \(too many requests\); 6 \(2026-11-20, Committee 6\): not requested/);
  assert.match(last(res), /^Source: NYC Council Legistar Web API/);
});

test("a single request (not the agenda fan-out) still retries a 429", async () => {
  let n = 0;
  globalThis.fetch = async () => (++n === 1 ? new Response("", { status: 429, headers: { "Retry-After": "0" } }) : new Response("[1]", { status: 200 }));
  assert.deepEqual(await legistarFetch(URL_, { sleep: async () => {} }), [1]);
  assert.equal(n, 2);
});

// ------------------------------------------------------------------ 4. reading the body

test("a reply body that is not JSON is a plain LegistarError", async () => {
  globalThis.fetch = async () => new Response("<html>gateway error</html>", { status: 200 });
  await assert.rejects(legistarFetch(URL_), (e) => {
    assert.ok(e instanceof LegistarError, String(e));
    assert.match(e.message, /^The Legistar API's reply could not be read \(/);
    assert.ok(!e.message.includes("T0K3N"));
    return true;
  });
  const res = await handleLiveTool("get_votes", { event_item_id: 1 }, "tok");
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /^Error: The Legistar API's reply could not be read .*Try again in a minute/);
});

test("a timeout while reading the reply body is a plain LegistarError", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); },
  });
  await assert.rejects(legistarFetch(URL_, { timeoutMs: 20 }), (e) => {
    assert.ok(e instanceof LegistarError, String(e));
    assert.match(e.message, /^The Legistar API's reply did not arrive in full within 0\.02 seconds\.$/);
    return true;
  });
});

// ------------------------------------------------------------------ 6 and 7. get_council_member over 10 matches

test("get_council_member past 10 matches says how many there are, and the source line stays last", async () => {
  const people = Array.from({ length: 12 }, (_, i) => ({ PersonId: 900 + i, PersonFullName: `Alex Example${i}`, PersonActiveFlag: 1 }));
  globalThis.fetch = async () => new Response(JSON.stringify(people), { status: 200 });
  const res = councilMemberAnswer(await handleLiveTool("get_council_member", { name: "Alex" }, "tok"), null);
  assert.equal(JSON.parse(res.content[0].text).length, COUNCIL_MEMBER_MAX);
  assert.equal(res.content[1].text, 'Showing 10 of 12 active members whose name matches "Alex"; more are available. Use more of the name.');
  assert.equal(res.content.length, 3);
  assert.match(last(res), /^Source: NYC Council Legistar Web API/);

  globalThis.fetch = async () => new Response(JSON.stringify(people.slice(0, 10)), { status: 200 });
  const exact = await handleLiveTool("get_council_member", { name: "Alex" }, "tok");
  assert.equal(exact.content.length, 2, "10 matches: no note");
});

// ------------------------------------------------------------------ 9. "not official" on the tools with a curated block

test("the tools that return a curated block say it is not an official record", () => {
  for (const t of [...LIVE_TOOL_DEFS, ...LOCAL_TOOL_DEFS].filter((d) => /'curated' block/.test(d.description))) {
    assert.match(t.description, /'curated' block \(BetaNYC's checked facts, not official records\)/, t.name);
  }
  const names = [...LIVE_TOOL_DEFS, ...LOCAL_TOOL_DEFS].filter((d) => /not official records/.test(d.description)).map((d) => d.name).sort();
  assert.deepEqual(names, ["get_council_member", "get_member_roles"]);
});
