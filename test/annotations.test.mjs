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

test("openWorldHint: live tools true, local tools false, except upcoming_events (live status check)", () => {
  for (const t of [...LIVE_TOOL_DEFS, LIVE_SEARCH_TOOL_DEF]) assert.equal(t.annotations.openWorldHint, true, t.name);
  for (const t of LOCAL_TOOL_DEFS) assert.equal(t.annotations.openWorldHint, t.name === "upcoming_events", t.name);
});
