// Regression test for get_bill's first-match-wins collision on bare file numbers.
//
// Bug: a file number is unique only WITH its type prefix. When a bare
// NNNN-YYYY is supplied, getBill tries prefixes in the order Int, Res, LU and
// returns the FIRST that matches. For a number where several types exist —
// e.g. 0540-2026 is BOTH "Int 0540-2026" (an Introduction still in committee)
// AND "Res 0540-2026" (the ADOPTED FY2027 contract-budget resolution) —
// getBill silently returns only the Introduction and hides the Resolution.
//
// This test encodes the fixed contract: a bare number matching more than one
// matter returns ALL of them. (Alternative contract — raise an ambiguity error
// naming every match — would swap the assertions below for assert.rejects and
// a message check. Either way, the current silent-single-result behavior is
// wrong.)

import { test } from "node:test";
import assert from "node:assert/strict";

import { getBill } from "../dist/legistar.js";

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
