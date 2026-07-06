// Tests for the shared America/New_York date helper.
//
// Bug guarded against: date windows were computed with toISOString() (UTC),
// so after 8pm ET (7pm EST) "today" rolled to tomorrow — upcoming-hearings and
// recent-bills windows were off by one day every evening.

import { test } from "node:test";
import assert from "node:assert/strict";

import { nyDateString } from "../dist/dates.js";

test("nyDateString formats YYYY-MM-DD", () => {
  assert.match(nyDateString(new Date()), /^\d{4}-\d{2}-\d{2}$/);
});

test("nyDateString: late-evening UTC instant is still the prior day in New York", () => {
  // 2026-01-02T03:00Z = 2026-01-01 22:00 EST
  assert.equal(nyDateString(new Date("2026-01-02T03:00:00Z")), "2026-01-01");
  // 2026-07-06T02:00Z = 2026-07-05 22:00 EDT
  assert.equal(nyDateString(new Date("2026-07-06T02:00:00Z")), "2026-07-05");
});

test("nyDateString: daytime instants agree with UTC date", () => {
  assert.equal(nyDateString(new Date("2026-07-06T15:00:00Z")), "2026-07-06");
});
