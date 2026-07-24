// Regression test for get_bill's first-match-wins collision on bare file numbers.
//
// Bug: a file number is unique only WITH its type prefix. When a bare
// NNNN-YYYY is supplied, getBill tries prefixes in the order Int, Res, LU and
// returns the FIRST that matches. For a number where several types exist —
// e.g. 0540-2026 is BOTH "Int 0540-2026" (an Introduction still in committee)
// AND "Res 0540-2026" (the ADOPTED FY2027 contract-budget resolution) —
// getBill silently returns only the Introduction and hides the Resolution.
//
// The fixed contract has two layers. The getBill() library primitive returns
// ALL matching matters — it must, or ambiguity can't be detected. The get_bill
// TOOL handler then REJECTS an ambiguous bare number, erroring and naming every
// match rather than silently resolving to one. A single unambiguous match
// returns that one matter.

import { test } from "node:test";
import assert from "node:assert/strict";

import { getBill } from "../dist/legistar.js";
import { handleLiveTool } from "../dist/tools/live.js";

const TOKEN = "test-token";

/** Install a fetch mock that returns `responses` in order (mirrors the seam in
 *  legistar.encoding.test.mjs). */
function mockFetch(responses) {
  const urls = [];
  let i = 0;
  global.fetch = async (url) => {
    urls.push(String(url));
    const body = responses[Math.min(i++, responses.length - 1)];
    return { ok: true, json: async () => body };
  };
  return urls;
}

test("getBill: a bare number matching both Int and Res returns both, not just the first prefix", async () => {
  mockFetch([
    [], // "0540-2026"      (bare) → none
    [{ MatterId: 78165, MatterFile: "Int 0540-2026" }], // "Int 0540-2026" → Introduction (in committee)
    [{ MatterId: 79146, MatterFile: "Res 0540-2026" }], // "Res 0540-2026" → Resolution (adopted budget)
    [], // "LU 0540-2026"   → none
  ]);

  const res = await getBill(TOKEN, "0540-2026");
  const files = res.map((m) => m.MatterFile);

  assert.ok(
    files.includes("Res 0540-2026"),
    `the adopted Resolution must not be hidden; got ${JSON.stringify(files)}`
  );
  assert.ok(
    files.includes("Int 0540-2026"),
    `the Introduction should still be present; got ${JSON.stringify(files)}`
  );
  assert.equal(res.length, 2, `both matters should be returned; got ${res.length}`);
});

// getBill returning both is only half the fix: at the MCP boundary an ambiguous
// bare number must be REJECTED — naming every match — not silently resolved to
// one. The handler used to render results[0], reproducing the very bug #27 fixes.
test("get_bill tool: an ambiguous bare number is rejected, naming every match", async () => {
  mockFetch([
    [], // "0540-2026"      (bare) → none
    [{ MatterId: 78165, MatterFile: "Int 0540-2026" }],
    [{ MatterId: 79146, MatterFile: "Res 0540-2026" }],
    [], // "LU 0540-2026"   → none
  ]);

  const res = await handleLiveTool("get_bill", { file_number: "0540-2026" }, TOKEN);
  assert.equal(res.isError, true, "an ambiguous bare number must error, not silently pick one");

  const text = res.content[0].text;
  assert.match(text, /Int 0540-2026/, "the error must name the Introduction");
  assert.match(text, /Res 0540-2026/, "the error must name the adopted Resolution");
});

// The unambiguous path stays non-breaking: exactly one match returns that one
// matter as an object, the shape get_bill returned before #27.
test("get_bill tool: an unambiguous match returns the single matter as an object", async () => {
  mockFetch([
    [{ MatterId: 79146, MatterFile: "Res 0540-2026" }], // "Res 0540-2026" → exactly one
  ]);

  const res = await handleLiveTool("get_bill", { file_number: "Res 0540-2026" }, TOKEN);
  assert.notEqual(res.isError, true, `expected success, got: ${res.content[0].text}`);

  const payload = JSON.parse(res.content[0].text);
  assert.equal(Array.isArray(payload), false, "a single unambiguous match returns an object, not an array");
  assert.equal(payload.MatterFile, "Res 0540-2026");
});
