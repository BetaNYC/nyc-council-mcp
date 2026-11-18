// Live checks against the Council's Legistar site and Web API (#91): read-only GETs. Never run by
// `npm test` or CI, which run only test/*.test.mjs. Run by hand:
//   LEGISTAR_TOKEN=… npm run test:live
// The gateway check needs no token; the attachments check is skipped without one.

import { test } from "node:test";
import assert from "node:assert/strict";

import { legistarUrl, getMatterAttachments } from "../../dist/legistar.js";

// [file, API MatterId, website LegislationDetail ID the gateway redirects to], checked 2026-11-12.
// Same fixtures as test/legistar.url.test.mjs.
const FIXTURES = [
  ["Res 0551-2026", 79177, 8134167],
  ["Res 0595-2026", 79255, 8166249],
  ["Res 0652-2026", 79533, 8219009],
  ["Res 0695-2026", 79639, 8286520],
  ["T2026-2764", 79717, 8315915],
  ["Int 0976-2026", 78436, 8138338],
];

test("live: gateway redirects each fixture to its website page", async () => {
  for (const [file, matterId, websiteId] of FIXTURES) {
    const res = await fetch(legistarUrl(matterId), { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0" } });
    assert.equal(res.status, 302, file);
    assert.match(res.headers.get("location") ?? "", new RegExp(`LegislationDetail\\.aspx\\?ID=${websiteId}&`), file);
  }
});

test("live: Res 0551-2026 returns its 7 files incl. Charts for Resolution", { skip: !process.env.LEGISTAR_TOKEN }, async () => {
  const rows = await getMatterAttachments(process.env.LEGISTAR_TOKEN, 79177);
  assert.equal(rows.length, 7);
  assert.ok(rows.some((r) => r.MatterAttachmentHyperlink === "https://nyc.legistar1.com/nyc/attachments/5adbe428-66f2-49db-80d5-cf23ea26d2dc.pdf"));
});
