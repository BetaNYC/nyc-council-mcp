// Fixes from the live check of 2026-11-19 (release 2.10.0). Offline: fetch is stubbed.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { handleLiveTool } from "../dist/tools/live.js";
import { getUpcomingHearingsReport, minutesOfDay, sortByDateAndTime } from "../dist/legistar.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// The order Legistar gave on 2026-11-19 for $orderby=EventDate: same day, no time order.
const LEGISTAR_ORDER = [
  { EventId: 22545, EventDate: "2026-11-19T00:00:00", EventTime: "1:30 PM", EventBodyName: "City Council", EventItems: [] },
  { EventId: 22796, EventDate: "2026-11-19T00:00:00", EventTime: "11:00 AM", EventBodyName: "Committee on Finance", EventItems: [] },
  { EventId: 22842, EventDate: "2026-11-19T00:00:00", EventTime: "10:30 AM", EventBodyName: "Committee on Rules", EventItems: [] },
  { EventId: 22881, EventDate: "2026-11-19T00:00:00", EventTime: "10:00 AM", EventBodyName: "Committee on Immigration", EventItems: [] },
  { EventId: 22858, EventDate: "2026-11-20T00:00:00", EventTime: "9:30 AM", EventBodyName: "Committee on Fire", EventItems: [] },
  { EventId: 22819, EventDate: "2026-11-20T00:00:00", EventTime: "10:00 AM", EventBodyName: "Committee on Immigration", EventItems: [] },
];

test("minutesOfDay reads Legistar's EventTime, and gives null for anything else", () => {
  assert.equal(minutesOfDay("10:00 AM"), 600);
  assert.equal(minutesOfDay("12:00 PM"), 720);
  assert.equal(minutesOfDay("12:15 AM"), 15);
  assert.equal(minutesOfDay("1:30 PM"), 810);
  assert.equal(minutesOfDay("1:30 p.m."), 810);
  assert.equal(minutesOfDay(""), null);
  assert.equal(minutesOfDay(null), null);
  assert.equal(minutesOfDay("Recess"), null);
});

test("sortByDateAndTime: by day, then time; no readable time goes last on its day; ties keep Legistar's order", () => {
  const rows = [
    { EventId: 1, EventDate: "2026-11-20T00:00:00", EventTime: "9:30 AM" },
    { EventId: 2, EventDate: "2026-11-19T00:00:00", EventTime: null },
    { EventId: 3, EventDate: "2026-11-19T00:00:00", EventTime: "1:30 PM" },
    { EventId: 4, EventDate: "2026-11-19T00:00:00", EventTime: "10:00 AM" },
    { EventId: 5, EventDate: "2026-11-19T00:00:00", EventTime: "10:00 AM" },
  ];
  assert.deepEqual(sortByDateAndTime(rows).map((e) => e.EventId), [4, 5, 3, 2, 1]);
});

test("get_upcoming_hearings lists meetings on the same day in time order (live check, 2026-11-19)", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify(LEGISTAR_ORDER), { status: 200 });
  const res = await handleLiveTool("get_upcoming_hearings", { days_ahead: 1, include_agenda: false }, "tok");
  assert.ok(!res.isError, res.content[0].text);
  const shown = JSON.parse(res.content[0].text).map((e) => `${e.EventDate.slice(0, 10)} ${e.EventTime}`);
  assert.deepEqual(shown, [
    "2026-11-19 10:00 AM",
    "2026-11-19 10:30 AM",
    "2026-11-19 11:00 AM",
    "2026-11-19 1:30 PM",
    "2026-11-20 9:30 AM",
    "2026-11-20 10:00 AM",
  ]);
});

test("the agenda fan-out runs in the same time order", async () => {
  const asked = [];
  globalThis.fetch = async (url) => {
    const m = new URL(url).pathname.match(/\/events\/(\d+)\/eventitems$/);
    if (!m) return new Response(JSON.stringify(LEGISTAR_ORDER.map((e) => ({ ...e }))), { status: 200 });
    asked.push(Number(m[1]));
    return new Response("[]", { status: 200 });
  };
  const { events } = await getUpcomingHearingsReport("tok", 1, true);
  assert.deepEqual(events.map((e) => e.EventId), [22881, 22842, 22796, 22545, 22858, 22819]);
  assert.deepEqual(asked.slice(0, 5), [22881, 22842, 22796, 22545, 22858]);
});

test("get_votes with no votes says what that can mean, before the source line (live check, 2026-11-19)", async () => {
  globalThis.fetch = async () => new Response("[]", { status: 200 });
  const res = await handleLiveTool("get_votes", { event_item_id: 443873 }, "tok");
  assert.ok(!res.isError);
  assert.deepEqual(JSON.parse(res.content[0].text), [], "the JSON stays an array");
  assert.match(res.content[1].text, /^Legistar has no votes recorded for agenda item 443873\. The item may not have been voted on yet/);
  assert.match(res.content.at(-1).text, /^Source: /);
  assert.equal(res.content.length, 3);
});

test("get_votes with votes is unchanged: the JSON, then the source line", async () => {
  const votes = [{ VoteId: 1, VotePersonName: "A Member", VoteValueName: "Affirmative" }];
  globalThis.fetch = async () => new Response(JSON.stringify(votes), { status: 200 });
  const res = await handleLiveTool("get_votes", { event_item_id: 1 }, "tok");
  assert.deepEqual(JSON.parse(res.content[0].text), votes);
  assert.equal(res.content.length, 2);
  assert.match(res.content[1].text, /^Source: /);
});

// ------------------------------------------------------------- the ordering is said where BetaNYC does it

import { readFileSync, readdirSync } from "node:fs";
import { liveSourceLine } from "../dist/tools/live.js";

const DS = JSON.parse(readFileSync(new URL("../DATA-SOURCES.json", import.meta.url), "utf8"));
const entry = (id) => DS.sources.find((s) => s.id === id);

test("DATA-SOURCES: the live entry says BetaNYC puts a day's meetings in time order, and why", () => {
  const live = entry("live");
  assert.ok(live.tools.includes("get_upcoming_hearings"));
  assert.equal(live.changes.changed, true);
  assert.match(live.changes.detail, /get_upcoming_hearings puts meetings on the same day in time order \(by EventTime\), because Legistar's meeting date \(EventDate\) carries no time/);
});

test("DATA-SOURCES: the events entry says how the index's meeting lists are ordered", () => {
  const detail = entry("events").changes.detail;
  assert.match(detail, /search_events and get_bill_hearings newest day first, upcoming_events soonest day first, and get_event_bills by agenda item ID/);
  assert.match(detail, /meetings on the same day are in no set order/);
});

test("get_upcoming_hearings' source line says it reorders a day's meetings; other live lines do not", () => {
  assert.match(liveSourceLine("get_upcoming_hearings"), /puts meetings on the same day in time order, because Legistar's meeting date carries no time\); Legistar is the official record\./);
  for (const name of ["get_bill", "get_votes", "get_committee", "list_recent_legislation"]) {
    assert.doesNotMatch(liveSourceLine(name), /time order/, name);
  }
});

test("sortByDateAndTime has one caller, getUpcomingHearingsReport (a new caller must be added to DATA-SOURCES.json)", () => {
  const dist = new URL("../dist/", import.meta.url);
  const files = readdirSync(dist, { recursive: true }).filter((f) => f.endsWith(".js"));
  const calls = files.flatMap((f) =>
    [...readFileSync(new URL(f, dist), "utf8").matchAll(/(?<!function )sortByDateAndTime\(/g)].map(() => f)
  );
  assert.deepEqual(calls, ["legistar.js"]);
  const src = readFileSync(new URL("legistar.js", dist), "utf8");
  const body = src.slice(src.indexOf("export async function getUpcomingHearingsReport"), src.indexOf("export const SUMMARY_TITLE_MAX"));
  assert.match(body, /sortByDateAndTime\(await legistarFetch/);
});
