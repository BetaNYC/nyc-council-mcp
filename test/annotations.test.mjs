// Every tool says it only reads, and whether it reaches outside (#82). Without readOnlyHint a
// client must treat a tool as one that may write. openWorldHint is true for tools that call the
// live Legistar API, false for tools that answer from the local index or the files in data/.

import { test } from "node:test";
import assert from "node:assert/strict";

import { betanycTools, toolList } from "../dist/server.js";
import { assertEveryToolAnnotated } from "../dist/betanyc-tools.js";
import { LOCAL_TOOL_DEFS } from "../dist/tools/local.js";
import { LIVE_TOOL_DEFS, LIVE_SEARCH_TOOL_DEF } from "../dist/tools/live.js";

const shared = betanycTools({ db: null, hasLive: true, version: "0.0.0" }).tools;

test("every tool the server can list is annotated, in every mode", () => {
  for (const mode of [{ hasLive: true, hasLocal: true }, { hasLive: true, hasLocal: false }, { hasLive: false, hasLocal: true }]) {
    assertEveryToolAnnotated(toolList(mode, shared));
  }
  // get_bill_history's live definition is hidden by the local one in hybrid mode; check it too.
  assertEveryToolAnnotated([...LOCAL_TOOL_DEFS, ...LIVE_TOOL_DEFS, LIVE_SEARCH_TOOL_DEF]);
});

test("every tool is read-only and has a title", () => {
  for (const t of toolList({ hasLive: true, hasLocal: true }, shared)) {
    assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.ok(t.annotations.title, `${t.name} has no title`);
  }
});

// Written out by hand, not derived from the code's own rule, so a change to either shows here.
const LIVE_OPEN = [
  "get_bill", "get_bill_history", "get_bill_attachments", "get_upcoming_hearings", "get_council_member",
  "get_committee", "get_votes", "list_recent_legislation", "search_legislation_live",
];
const OPEN_WORLD = {
  // get_bill_history is the local one in hybrid mode; upcoming_events checks status live with a token.
  hybrid: ["get_bill", "get_bill_attachments", "get_upcoming_hearings", "get_council_member", "get_committee",
    "get_votes", "list_recent_legislation", "search_legislation_live", "upcoming_events"],
  live: LIVE_OPEN,
  local: ["upcoming_events"],
};
const MODES = { hybrid: { hasLive: true, hasLocal: true }, live: { hasLive: true, hasLocal: false }, local: { hasLive: false, hasLocal: true } };

test("openWorldHint: exactly these tools are open-world, in each mode", () => {
  for (const [mode, flags] of Object.entries(MODES)) {
    const open = toolList(flags, shared).filter((t) => t.annotations.openWorldHint === true).map((t) => t.name).sort();
    assert.deepEqual(open, [...OPEN_WORLD[mode]].sort(), mode);
  }
  // The live get_bill_history, hidden by the local one in hybrid mode, is open-world too.
  assert.deepEqual([...LIVE_TOOL_DEFS, LIVE_SEARCH_TOOL_DEF].filter((t) => t.annotations.openWorldHint).map((t) => t.name).sort(), [...LIVE_OPEN].sort());
  assert.deepEqual(LOCAL_TOOL_DEFS.filter((t) => t.annotations.openWorldHint).map((t) => t.name), ["upcoming_events"]);
});
