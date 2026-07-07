// Regression tests for OData $filter encoding in live Legistar calls.
//
// The bug: query strings were passed through encodeURIComponent() *inside*
// the $filter string, and then URLSearchParams encoded the whole parameter
// again — so "public housing" went over the wire as public%2520housing and
// matched nothing. The fix: odataString() escapes only OData single quotes
// (' → ''); URLSearchParams performs the single URL-encoding pass.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  searchLegislation,
  getBill,
  getCouncilMember,
  getCommittee,
  odataString,
} from "../dist/legistar.js";

const TOKEN = "test-token";

/** Install a fetch mock that records URLs and returns `responses` in order. */
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

/** Decode the $filter param the way the server sees it (one decode pass). */
function filterOf(url) {
  return new URL(url).searchParams.get("$filter");
}

test("odataString doubles single quotes and nothing else", () => {
  assert.equal(odataString("O'Neill"), "O''Neill");
  assert.equal(odataString("public housing"), "public housing");
  assert.equal(odataString("50% & more"), "50% & more");
});

test("searchLegislation: multi-word query is single-encoded (no %25 double encoding)", async () => {
  const urls = mockFetch([[]]);
  await searchLegislation(TOKEN, "public housing");
  // Each word becomes its own (title OR name) group, AND-ed together, so a
  // matter containing both words in any order matches — not just the exact
  // contiguous phrase "public housing".
  const filter = filterOf(urls[0]);
  assert.equal(
    filter,
    "(substringof('public',MatterTitle) or substringof('public',MatterName)) and " +
      "(substringof('housing',MatterTitle) or substringof('housing',MatterName))"
  );
  // The raw URL must not contain a double-encoded space or percent sign
  assert.ok(!urls[0].includes("%25"), `double-encoded URL: ${urls[0]}`);
});

test("searchLegislation: single-token query is a single (title OR name) group", async () => {
  const urls = mockFetch([[]]);
  await searchLegislation(TOKEN, "254");
  assert.equal(
    filterOf(urls[0]),
    "(substringof('254',MatterTitle) or substringof('254',MatterName))"
  );
});

test("searchLegislation: a quoted phrase stays a single contiguous-substring term", async () => {
  const urls = mockFetch([[]]);
  await searchLegislation(TOKEN, '"capital program"');
  assert.equal(
    filterOf(urls[0]),
    "(substringof('capital program',MatterTitle) or substringof('capital program',MatterName))"
  );
});

test("searchLegislation: an empty/whitespace query returns [] without calling the API", async () => {
  const urls = mockFetch([[{ MatterId: 1 }]]);
  const res = await searchLegislation(TOKEN, "   ");
  assert.deepEqual(res, []);
  assert.equal(urls.length, 0, "no API call should be made for an empty query");
});

test("searchLegislation: order defaults to newest-first and date_asc flips to oldest-first", async () => {
  const urls = mockFetch([[], []]);
  await searchLegislation(TOKEN, "capital");
  assert.equal(new URL(urls[0]).searchParams.get("$orderby"), "MatterIntroDate desc");
  await searchLegislation(TOKEN, "capital", 20, "date_asc");
  assert.equal(new URL(urls[1]).searchParams.get("$orderby"), "MatterIntroDate asc");
});

test("searchLegislation: single quotes are OData-escaped, not URI-encoded", async () => {
  const urls = mockFetch([[]]);
  await searchLegislation(TOKEN, "O'Neill's bill");
  // "O'Neill's" and "bill" become separate AND-ed terms; the apostrophes in
  // the first token are OData-escaped (doubled), not percent-encoded.
  const filter = filterOf(urls[0]);
  assert.ok(filter.includes("substringof('O''Neill''s',MatterTitle)"), filter);
  assert.ok(!urls[0].includes("%25"), `double-encoded URL: ${urls[0]}`);
});

test("getCouncilMember and getCommittee: names with spaces survive one encoding pass", async () => {
  const urls = mockFetch([[]]);
  await getCouncilMember(TOKEN, "Sandy Nurse");
  await getCommittee(TOKEN, "Technology and Innovation");
  assert.ok(filterOf(urls[0]).includes("substringof('Sandy Nurse',PersonFullName)"));
  assert.ok(filterOf(urls[1]).includes("substringof('Technology and Innovation',BodyName)"));
});

test("getBill: tries the file number as given first", async () => {
  const urls = mockFetch([[{ MatterId: 1, MatterFile: "Int 0349-2024" }]]);
  const res = await getBill(TOKEN, "Int 0349-2024");
  assert.equal(res.length, 1);
  assert.equal(urls.length, 1);
  assert.equal(filterOf(urls[0]), "MatterFile eq 'Int 0349-2024'");
});

test("getBill: bare NNNN-YYYY retries with Int/Res/LU prefixes (MatterFile is prefixed live)", async () => {
  // Verified live 2026-07-06: MatterFile eq '0349-2024' → [], 'Int 0349-2024' → 1 row
  const urls = mockFetch([[], [{ MatterId: 73313, MatterFile: "Int 0349-2024" }]]);
  const res = await getBill(TOKEN, "0349-2024");
  assert.equal(res.length, 1);
  assert.equal(res[0].MatterFile, "Int 0349-2024");
  assert.equal(filterOf(urls[0]), "MatterFile eq '0349-2024'");
  assert.equal(filterOf(urls[1]), "MatterFile eq 'Int 0349-2024'");
});

test("getBill: exhausts Int/Res/LU prefixes then returns []", async () => {
  const urls = mockFetch([[]]);
  const res = await getBill(TOKEN, "9999-2024");
  assert.equal(res.length, 0);
  assert.deepEqual(
    urls.map(filterOf),
    [
      "MatterFile eq '9999-2024'",
      "MatterFile eq 'Int 9999-2024'",
      "MatterFile eq 'Res 9999-2024'",
      "MatterFile eq 'LU 9999-2024'",
    ]
  );
});
