// Every tool definition and the server instructions are sent to the model on every turn, so
// their size is a cost (#89). Measured with toolListSize from the shared module, the same
// measure as nyc-311-mcp's test/tool-size.test.mjs, over the largest list the server can send:
// hybrid mode, all 28 tools.
//
// 2026-11-18: measured 29,678 characters (with annotations, shared module 1.5.0); the budget
// is that plus about 5%. Later the same day, review fixes (epic #95, shared module 1.5.1, a short
// "not official records" note back on the two tools with a curated block): 30,068; budget unchanged. If a change needs more, raise it on purpose with a dated line here
// saying why, and put text several tools share in the server instructions instead of
// repeating it in each description.

import { test } from "node:test";
import assert from "node:assert/strict";

import { betanycTools, toolList, SERVER_INSTRUCTIONS } from "../dist/server.js";
import { toolListSize } from "../dist/betanyc-tools.js";

const BUDGET_CHARS = 31_000;

test("tool definitions plus server instructions stay within the size budget", () => {
  const shared = betanycTools({ db: null, hasLive: true, version: "0.0.0" }).tools;
  const size = toolListSize(toolList({ hasLive: true, hasLocal: true }, shared), SERVER_INSTRUCTIONS);
  assert.ok(size <= BUDGET_CHARS, `tools/list JSON + instructions is ${size} characters, over the ${BUDGET_CHARS} budget`);
});
