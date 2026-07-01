// Regression tests for getUpcomingHearings agenda-item population.
//
// Run with:  npm test   (builds first, then `node --test`)
//
// These mock global.fetch with the shapes VERIFIED LIVE 2026-07-01 against the
// real Legistar API (per engineering-standards §0 — mocks encode the documented
// contract, not a guess):
//   - GET /events        → returns events with EventItems: [] (always empty;
//                          $expand=EventItems is silently ignored)
//   - GET /events/{id}/eventitems → returns the real agenda items
//
// The bug these guard against: getUpcomingHearings used to return the /events
// response verbatim, so every event's EventItems was [] and the agenda (which
// bills a hearing is about) was never available.

import { test } from "node:test";
import assert from "node:assert/strict";

import { getUpcomingHearings, getEventItems } from "../dist/legistar.js";

const TOKEN = "test-token";

// One real-shape agenda item (subset of the 36 verified live fields, with the
// key fields the newsletter feature depends on populated).
function makeItem(eventId, matterFile, title) {
  return {
    EventItemId: 90000 + Math.floor(Math.random() * 1000),
    EventItemGuid: "GUID-" + matterFile,
    EventItemLastModifiedUtc: "2026-06-30T00:00:00",
    EventItemRowVersion: "AAA=",
    EventItemEventId: eventId,
    EventItemAgendaSequence: 1,
    EventItemMinutesSequence: 1,
    EventItemAgendaNumber: null,
    EventItemVideo: null,
    EventItemVideoIndex: null,
    EventItemVersion: "*",
    EventItemAgendaNote: null,
    EventItemMinutesNote: null,
    EventItemActionId: null,
    EventItemActionName: null,
    EventItemActionText: null,
    EventItemPassedFlag: null,
    EventItemPassedFlagName: null,
    EventItemRollCallFlag: 0,
    EventItemFlagExtra: null,
    EventItemTitle: title,
    EventItemTally: null,
    EventItemAccelaRecordId: null,
    EventItemConsent: 0,
    EventItemMoverId: null,
    EventItemMover: null,
    EventItemSeconderId: null,
    EventItemSeconder: null,
    EventItemMatterId: 12345,
    EventItemMatterGuid: "MGUID-" + matterFile,
    EventItemMatterFile: matterFile,
    EventItemMatterName: title,
    EventItemMatterType: "Land Use Application",
    EventItemMatterStatus: "Filed",
    EventItemMatterAttachments: [],
  };
}

function makeEvent(eventId, bodyName) {
  // Mirrors the /events list response: EventItems present but always empty.
  return {
    EventId: eventId,
    EventGuid: "EGUID-" + eventId,
    EventLastModifiedUtc: "2026-06-30T00:00:00",
    EventDate: "2026-07-07T00:00:00",
    EventTime: "10:00 AM",
    EventVideoStatus: "Public",
    EventVideoPath: null,
    EventAgendaStatusId: 1,
    EventAgendaStatusName: "Final",
    EventMinutesStatusId: 1,
    EventMinutesStatusName: "Draft",
    EventLocation: "City Hall",
    EventBodyId: 1,
    EventBodyName: bodyName,
    EventAgendaFile: null,
    EventMinutesFile: null,
    EventInSiteURL: null,
    EventItems: [],
  };
}

// Install a fetch stub that routes by URL path, matching the live API's two
// distinct endpoints. `failEventIds` lets a test force a per-event failure.
function installFetch({ events, itemsByEvent, failEventIds = new Set() }) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname);
    const m = u.pathname.match(/\/events\/(\d+)\/eventitems$/);
    if (m) {
      const id = Number(m[1]);
      if (failEventIds.has(id)) {
        return { ok: false, status: 500, statusText: "Internal Server Error" };
      }
      return { ok: true, json: async () => itemsByEvent[id] ?? [] };
    }
    if (u.pathname.endsWith("/events")) {
      // Legistar always returns EventItems empty here, ignoring $expand.
      return { ok: true, json: async () => events.map((e) => ({ ...e, EventItems: [] })) };
    }
    throw new Error("unexpected URL in test: " + u.pathname);
  };
  return calls;
}

test("populates EventItems from the per-event /eventitems endpoint", async () => {
  const events = [makeEvent(22566, "Subcommittee on Zoning and Franchises"), makeEvent(22525, "Subcommittee on Landmarks")];
  const itemsByEvent = {
    22566: [makeItem(22566, "LU 0100-2026", "2950 West 24th Street Rezoning"), makeItem(22566, "LU 0101-2026", "Another matter")],
    22525: [makeItem(22525, "LU 0055-2026", "A landmark matter")],
  };
  installFetch({ events, itemsByEvent });

  const result = await getUpcomingHearings(TOKEN, 14);

  assert.equal(result.length, 2);
  // The core regression: EventItems must NOT be empty anymore.
  assert.equal(result[0].EventItems.length, 2, "event 22566 should have 2 agenda items");
  assert.equal(result[1].EventItems.length, 1, "event 22525 should have 1 agenda item");
  assert.equal(result[0].EventItems[0].EventItemMatterFile, "LU 0100-2026");
});

test("include_agenda=false skips the follow-up calls and leaves EventItems empty", async () => {
  const events = [makeEvent(22566, "Subcommittee on Zoning and Franchises")];
  const calls = installFetch({ events, itemsByEvent: { 22566: [makeItem(22566, "LU 0100-2026", "x")] } });

  const result = await getUpcomingHearings(TOKEN, 14, false);

  assert.equal(result[0].EventItems.length, 0, "opt-out should leave EventItems empty");
  assert.ok(!calls.some((p) => p.includes("/eventitems")), "no /eventitems calls should be made when opted out");
});

test("degrades gracefully: one event's /eventitems failure leaves that event empty, others populated", async () => {
  const events = [makeEvent(22566, "A"), makeEvent(22525, "B")];
  const itemsByEvent = {
    22566: [makeItem(22566, "LU 0100-2026", "ok")],
    22525: [makeItem(22525, "LU 0055-2026", "should-not-appear")],
  };
  installFetch({ events, itemsByEvent, failEventIds: new Set([22525]) });

  const result = await getUpcomingHearings(TOKEN, 14);

  const e66 = result.find((e) => e.EventId === 22566);
  const e25 = result.find((e) => e.EventId === 22525);
  assert.equal(e66.EventItems.length, 1, "healthy event still populated");
  assert.equal(e25.EventItems.length, 0, "failed event degrades to empty, does not throw");
});

test("getEventItems hits the correct endpoint and returns the items", async () => {
  installFetch({ events: [], itemsByEvent: { 22566: [makeItem(22566, "LU 0100-2026", "x")] } });
  const items = await getEventItems(TOKEN, 22566);
  assert.equal(items.length, 1);
  assert.equal(items[0].EventItemMatterFile, "LU 0100-2026");
});
