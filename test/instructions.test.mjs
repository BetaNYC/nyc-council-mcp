// Text several tools share lives once in the server instructions, not in each description (#94).

import { test } from "node:test";
import assert from "node:assert/strict";

import { SERVER_INSTRUCTIONS } from "../dist/server.js";
import { BETANYC_INSTRUCTIONS } from "../dist/betanyc-tools.js";
import { LOCAL_TOOL_DEFS } from "../dist/tools/local.js";
import { LIVE_TOOL_DEFS, LIVE_SEARCH_TOOL_DEF } from "../dist/tools/live.js";

const DOMAIN = [...LOCAL_TOOL_DEFS, ...LIVE_TOOL_DEFS, LIVE_SEARCH_TOOL_DEF];

test("the instructions keep the shared about_data paragraph and carry the shared text once", () => {
  assert.ok(SERVER_INSTRUCTIONS.includes(BETANYC_INSTRUCTIONS));
  assert.match(SERVER_INSTRUCTIONS, /'curated' block: BetaNYC's hand-checked Wikidata\/Wikipedia link, party/);
  assert.match(SERVER_INSTRUCTIONS, /need no LEGISTAR_TOKEN/);
  assert.match(SERVER_INSTRUCTIONS, /source line/);
});

test("no sentence of 20 or more characters is repeated across tool descriptions", () => {
  const seen = new Map();
  for (const t of DOMAIN) {
    for (const s of new Set(t.description.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length >= 20))) {
      seen.set(s, [...(seen.get(s) ?? []), t.name]);
    }
  }
  // The two get_bill_history definitions (local and live) are never listed together.
  const repeated = [...seen].filter(([, names]) => new Set(names).size > 1 && !names.every((n) => n === "get_bill_history"));
  assert.deepEqual(repeated, []);
});

test("the curated explanation and 'no token' notes are not repeated in descriptions", () => {
  for (const t of DOMAIN) {
    assert.doesNotMatch(t.description, /Wikidata\/Wikipedia link, party/, t.name);
    assert.doesNotMatch(t.description, /No token (needed|required)/, t.name);
  }
});
