// Regression tests for legistarUrl — the human-openable Legistar link (#45).
//
// Run with:  npm test   (builds first, then `node --test`)
//
// WHY gateway.aspx: NYC's OData MatterId is NOT the website's
// LegislationDetail.aspx ID, so that page cannot be built from the API record.
// legistar.council.nyc.gov/gateway.aspx?M=L&ID={MatterId} takes the API id and
// 302-redirects to the right LegislationDetail page, for every matter type.
// Fixtures below were checked live 2026-11-12 (API MatterId → website ID the
// redirect lands on). An unknown id gets a 200 "This record is currently
// unavailable." page, not a redirect. gateway.aspx is not in Granicus's docs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { legistarUrl } from "../dist/legistar.js";

const GATEWAY = "https://legistar.council.nyc.gov/gateway.aspx?M=L&ID=";

// [file, API MatterId, website LegislationDetail ID the gateway redirects to]
const FIXTURES = [
  ["Res 0551-2026", 79177, 8134167],
  ["Res 0595-2026", 79255, 8166249],
  ["Res 0652-2026", 79533, 8219009],
  ["Res 0695-2026", 79639, 8286520],
  ["T2026-2764", 79717, 8315915],
  ["Int 0976-2026", 78436, 8138338],
];

for (const [file, matterId] of FIXTURES) {
  test(`${file} (MatterId ${matterId}) → gateway link keyed on the API id`, () => {
    assert.equal(legistarUrl(matterId), `${GATEWAY}${matterId}`);
  });
}

test("Resolutions and other non-Int types get a link (was null before #45)", () => {
  assert.notEqual(legistarUrl(79177), null);
});

test("null / undefined / non-positive / non-integer id → null", () => {
  assert.equal(legistarUrl(null), null);
  assert.equal(legistarUrl(undefined), null);
  assert.equal(legistarUrl(0), null);
  assert.equal(legistarUrl(-5), null);
  assert.equal(legistarUrl(1.5), null);
  assert.equal(legistarUrl(Number.NaN), null);
});

// Opt-in live check: LEGISTAR_LIVE_URL_TEST=1 npm test
test("live: gateway redirects each fixture to its website page", { skip: !process.env.LEGISTAR_LIVE_URL_TEST }, async () => {
  for (const [file, matterId, websiteId] of FIXTURES) {
    const res = await fetch(legistarUrl(matterId), { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0" } });
    assert.equal(res.status, 302, file);
    assert.match(res.headers.get("location") ?? "", new RegExp(`LegislationDetail\\.aspx\\?ID=${websiteId}&`), file);
  }
});
