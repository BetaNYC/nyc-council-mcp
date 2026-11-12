// Answers that are too big (#29, #22).
//
// #29: get_event_bills returned every agenda item. One stated meeting
// (event 22592) has 178 items, about 85 KB. It now pages: limit (default 50),
// offset, and the total.
//
// #22: get_upcoming_hearings returned every Legistar field on every agenda
// item, most of them null bookkeeping, plus unbounded Land Use titles. About
// 20 KB for 6 events. It now defaults to a short shape; detail:"full" returns
// the old payload unchanged.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { handleLocalTool } from "../dist/tools/local.js";
import { handleLiveTool, LIVE_TOOL_DEFS } from "../dist/tools/live.js";
import { CREATE_TABLES } from "../dist/db/schema.js";

// ---------------------------------------------------------------- #29

function agendaDb(n) {
  const db = new Database(":memory:");
  db.exec(CREATE_TABLES);
  db.prepare("INSERT INTO events (event_id, date, body_name, source_json) VALUES (?,?,?,?)")
    .run(22592, "2026-06-30", "City Council", "{}");
  const ins = db.prepare(
    "INSERT INTO event_items (event_item_id, event_id, matter_id, file_number, title, action_name) VALUES (?,?,?,?,?,?)"
  );
  for (let i = 1; i <= n; i++) ins.run(1000 + i, 22592, 70000 + i, `Res ${String(i).padStart(4, "0")}-2026`, `Item ${i}`, "Adopted");
  return db;
}

const call = (args, db) => JSON.parse(handleLocalTool("get_event_bills", args, db).content[0].text);

test("get_event_bills pages by default: 50 items, with the total", () => {
  const out = call({ event_id: 22592 }, agendaDb(178));
  assert.equal(out.total, 178);
  assert.equal(out.offset, 0);
  assert.equal(out.limit, 50);
  assert.equal(out.items.length, 50);
  assert.equal(out.items[0].event_item_id, 1001);
});

test("get_event_bills offset reaches the end of the agenda", () => {
  const out = call({ event_id: 22592, offset: 150, limit: 50 }, agendaDb(178));
  assert.equal(out.items.length, 28);
  assert.equal(out.items.at(-1).event_item_id, 1178);
  assert.equal(out.total, 178);
});

test("get_event_bills rejects a limit above 500", () => {
  const res = handleLocalTool("get_event_bills", { event_id: 22592, limit: 501 }, agendaDb(1));
  assert.ok(res.isError);
});

// ---------------------------------------------------------------- #22

const LONG_TITLE =
  "Application number C 260089 PCQ (Queens CD 2 Walk to Park Site Selection/Acquisition) including: " +
  Array.from({ length: 47 }, (_, i) => `${i + 1} 47 Ave (Block 28, Lot ${i + 1})`).join(", ");

function event() {
  return {
    EventId: 22766, EventGuid: "G", EventLastModifiedUtc: "2026-10-01T00:00:00", EventDate: "2026-10-19T00:00:00",
    EventTime: "10:00 AM", EventVideoStatus: "Public", EventVideoPath: null, EventAgendaStatusId: 2,
    EventAgendaStatusName: "Final", EventMinutesStatusId: 1, EventMinutesStatusName: "Draft",
    EventLocation: "Council Chambers - City Hall", EventBodyId: 1, EventBodyName: "Committee on Health",
    EventAgendaFile: "https://example/agenda.pdf", EventMinutesFile: null,
    EventInSiteURL: "https://legistar.council.nyc.gov/MeetingDetail.aspx?LEGID=22766&GID=61&G=X", EventItems: [],
  };
}

function item(id, matter) {
  return {
    EventItemId: id, EventItemGuid: "G", EventItemLastModifiedUtc: "x", EventItemRowVersion: "AAAA",
    EventItemEventId: 22766, EventItemAgendaSequence: 1, EventItemMinutesSequence: null, EventItemAgendaNumber: "1",
    EventItemVideo: null, EventItemVideoIndex: null, EventItemVersion: "1", EventItemAgendaNote: null,
    EventItemMinutesNote: null, EventItemActionId: null, EventItemActionName: null, EventItemActionText: null,
    EventItemPassedFlag: null, EventItemPassedFlagName: null, EventItemRollCallFlag: null, EventItemFlagExtra: null,
    EventItemTitle: matter ? LONG_TITLE : "Roll Call", EventItemTally: null, EventItemAccelaRecordId: null,
    EventItemConsent: 0, EventItemMoverId: null, EventItemMover: null, EventItemSeconderId: null,
    EventItemSeconder: null, EventItemMatterId: matter ? 79500 : null, EventItemMatterGuid: matter ? "M" : null,
    EventItemMatterFile: matter ? "LU 0155-2026" : null, EventItemMatterName: matter ? "Walk to Park" : null,
    EventItemMatterType: matter ? "Land Use Application" : null, EventItemMatterStatus: matter ? "Committee" : null,
    EventItemMatterAttachments: [],
  };
}

function mockLegistar() {
  global.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    const body = path.endsWith("/eventitems") ? [item(1, false), item(2, true)] : [event()];
    return { ok: true, json: async () => body };
  };
}

async function hearings(args) {
  mockLegistar();
  const res = await handleLiveTool("get_upcoming_hearings", args, "t");
  assert.ok(!res.isError, res.content[0].text);
  return JSON.parse(res.content[0].text);
}

test("get_upcoming_hearings defaults to a short shape with no nulls", async () => {
  const [ev] = await hearings({});
  assert.equal(ev.EventBodyName, "Committee on Health");
  assert.equal(ev.EventAgendaStatusName, "Final");
  assert.ok(!("EventGuid" in ev));
  for (const it of ev.EventItems) {
    assert.ok(!("EventItemRowVersion" in it));
    assert.ok(Object.values(it).every((v) => v !== null), JSON.stringify(it));
  }
  const lu = ev.EventItems.find((it) => it.EventItemMatterFile === "LU 0155-2026");
  assert.equal(lu.EventItemId, 2, "keep the id get_votes takes");
  assert.equal(lu.legistar_url, "https://legistar.council.nyc.gov/gateway.aspx?M=L&ID=79500");
  assert.ok(lu.EventItemTitle.length <= 301 && lu.EventItemTitle.endsWith("…"));
  assert.equal(lu.EventItemTitleTruncated, true);
});

test("get_upcoming_hearings detail:'full' is the old payload, unchanged", async () => {
  const [ev] = await hearings({ detail: "full" });
  assert.equal(ev.EventGuid, "G");
  const lu = ev.EventItems.find((it) => it.EventItemMatterFile === "LU 0155-2026");
  assert.equal(lu.EventItemRowVersion, "AAAA");
  assert.equal(lu.EventItemTitle, LONG_TITLE);
});

test("summary is much smaller than full", async () => {
  const summary = JSON.stringify(await hearings({}));
  const full = JSON.stringify(await hearings({ detail: "full" }));
  assert.ok(summary.length * 2 < full.length, `summary ${summary.length} vs full ${full.length}`);
});

test("detail is advertised with summary as the default", () => {
  const def = LIVE_TOOL_DEFS.find((t) => t.name === "get_upcoming_hearings");
  assert.deepEqual(def.inputSchema.properties.detail.enum, ["summary", "full"]);
});
