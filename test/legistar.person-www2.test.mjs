// Regression tests for get_council_member's Legistar profile link (issue #38).
//
// Upstream data error: the Council's Legistar Persons record for Virginia
// Maloney (PersonId 7894) carries Elsie Encarnación's profile link in
// PersonWWW2 (PersonDetail.aspx?ID=329370), the same value as Encarnación's
// own record (PersonId 7895). The fixture values below are the live WebAPI
// values observed 2026-10-11 (GET /v1/nyc/persons), trimmed to the fields
// that matter. The fix is a dated override that applies only while upstream
// still carries the known-bad profile ID, plus a warning when two people in
// one result share a profile link.

import { test } from "node:test";
import assert from "node:assert/strict";

import { getCouncilMember, correctPersonProfiles, PERSON_WWW2_OVERRIDES } from "../dist/legistar.js";
import { handleLiveTool } from "../dist/tools/live.js";

const BAD =
  "https://legistar.council.nyc.gov/PersonDetail.aspx?ID=329370&GUID=06AE81E5-EB7C-47D1-92B6-2502C940258F&Search=";
const MALONEY_CORRECT =
  "https://legistar.council.nyc.gov/PersonDetail.aspx?ID=329369&GUID=0DEF07B0-6228-41F9-84D8-560C1659684D";

const maloney = () => ({
  PersonId: 7894,
  PersonFullName: "Virginia Maloney ",
  PersonActiveFlag: 1,
  PersonWWW: "https://council.nyc.gov/district-4/",
  PersonWWW2: BAD,
});
const encarnacion = () => ({
  PersonId: 7895,
  PersonFullName: "Elsie Encarnación",
  PersonActiveFlag: 1,
  PersonWWW: "https://council.nyc.gov/district-8/",
  PersonWWW2: BAD,
});

function mockFetch(body) {
  global.fetch = async () => ({ ok: true, json: async () => body });
}

test("get_council_member corrects Maloney's PersonWWW2 to her own profile (#38)", async () => {
  mockFetch([maloney()]);
  const res = await handleLiveTool("get_council_member", { name: "Maloney" }, "test-token");
  const [rec] = JSON.parse(res.content[0].text);
  assert.equal(rec.PersonWWW2, MALONEY_CORRECT);
  assert.equal(rec.PersonWWW2_upstream, BAD, "the upstream value is kept for transparency");
  assert.match(rec.PersonWWW2_warning, /Corrected/);
  assert.equal(rec.PersonWWW, "https://council.nyc.gov/district-4/", "other fields pass through");
});

test("Encarnación's own (correct) record is not altered (#38)", async () => {
  mockFetch([encarnacion()]);
  const [rec] = await getCouncilMember("test-token", "Encarn");
  assert.equal(rec.PersonWWW2, BAD);
  assert.equal(rec.PersonWWW2_upstream, undefined);
  assert.equal(rec.PersonWWW2_warning, undefined);
});

test("the override is a no-op once upstream is fixed (#38)", () => {
  const fixedUpstream = { ...maloney(), PersonWWW2: MALONEY_CORRECT + "&Search=" };
  const [rec] = correctPersonProfiles([fixedUpstream]);
  assert.equal(rec.PersonWWW2, fixedUpstream.PersonWWW2);
  assert.equal(rec.PersonWWW2_warning, undefined);
});

test("two people sharing one profile link without an override are both flagged, not dropped", () => {
  const a = { PersonId: 1, PersonFullName: "Member A", PersonWWW2: "https://legistar.council.nyc.gov/PersonDetail.aspx?ID=1&GUID=X" };
  const b = { PersonId: 2, PersonFullName: "Member B", PersonWWW2: "https://legistar.council.nyc.gov/PersonDetail.aspx?ID=1&GUID=X" };
  const [ra, rb] = correctPersonProfiles([a, b]);
  assert.equal(ra.PersonWWW2, a.PersonWWW2);
  assert.match(ra.PersonWWW2_warning, /shared with Member B/);
  assert.match(rb.PersonWWW2_warning, /shared with Member A/);
});

test("both Maloney and Encarnación in one result: Maloney corrected, Encarnación unflagged", () => {
  const [m, e] = correctPersonProfiles([maloney(), encarnacion()]);
  assert.equal(m.PersonWWW2, MALONEY_CORRECT);
  assert.equal(e.PersonWWW2, BAD);
  assert.equal(e.PersonWWW2_warning, undefined);
});

test("every override entry is dated and cites a reference", () => {
  for (const o of PERSON_WWW2_OVERRIDES) {
    assert.match(o.verified, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(o.reference, /^https:\/\//);
    assert.ok(new URL(o.correct).searchParams.get("ID"), "correct link must carry a profile ID");
  }
});
