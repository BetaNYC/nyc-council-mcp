// get_bill_attachments (#45): a matter's files (committee reports, charts,
// transcripts) from GET /v1/nyc/matters/{MatterId}/attachments, documented at
// https://webapi.legistar.com/Help/Api/GET-v1-Client-Matters-MatterId-Attachments
//
// Checked live 2026-11-12: Res 0551-2026 (MatterId 79177) returns 7 files, the
// same 7 its website page lists. MatterAttachmentHyperlink is a
// nyc.legistar1.com/nyc/attachments/<uuid> URL, not the website's View.ashx
// link, but the bytes are identical (SHA-1 matched for "Charts for
// Resolution", View.ashx?M=F&ID=15695414). T2026-2764 (79717) has none.

import { test } from "node:test";
import assert from "node:assert/strict";

import { getMatterAttachments } from "../dist/legistar.js";
import { LIVE_TOOL_DEFS, handleLiveTool } from "../dist/tools/live.js";

const TOKEN = "test-token";
const realFetch = global.fetch;

// Trimmed from the live 79177 response (field names exactly as returned).
const CHARTS = {
  MatterAttachmentId: 343904,
  MatterAttachmentGuid: "D5D2025D-4A7E-446D-86FB-808B491CD174",
  MatterAttachmentLastModifiedUtc: "2026-07-16T13:41:26.73",
  MatterAttachmentRowVersion: "AAAAAOhN7hE=",
  MatterAttachmentName: "Charts for Resolution",
  MatterAttachmentHyperlink: "https://nyc.legistar1.com/nyc/attachments/5adbe428-66f2-49db-80d5-cf23ea26d2dc.pdf",
  MatterAttachmentFileName: "5adbe428-66f2-49db-80d5-cf23ea26d2dc.pdf",
  MatterAttachmentMatterVersion: "0",
  MatterAttachmentIsHyperlink: false,
  MatterAttachmentBinary: null,
  MatterAttachmentIsSupportingDocument: false,
  MatterAttachmentShowOnInternetPage: true,
  MatterAttachmentIsMinuteOrder: false,
  MatterAttachmentIsBoardLetter: false,
  MatterAttachmentAgiloftId: 0,
  MatterAttachmentDescription: null,
  MatterAttachmentPrintWithReports: true,
  MatterAttachmentSort: 1,
};

function mockFetch(body) {
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => body };
  };
  return urls;
}

test("getMatterAttachments calls /matters/{id}/attachments with the token", async () => {
  const urls = mockFetch([CHARTS]);
  const res = await getMatterAttachments(TOKEN, 79177);
  assert.equal(urls.length, 1);
  const u = new URL(urls[0]);
  assert.equal(u.origin + u.pathname, "https://webapi.legistar.com/v1/nyc/matters/79177/attachments");
  assert.equal(u.searchParams.get("token"), TOKEN);
  assert.equal(res[0].MatterAttachmentHyperlink, CHARTS.MatterAttachmentHyperlink);
});

test("get_bill_attachments tool is advertised and strict", () => {
  const def = LIVE_TOOL_DEFS.find((t) => t.name === "get_bill_attachments");
  assert.ok(def, "get_bill_attachments must be in LIVE_TOOL_DEFS");
  assert.deepEqual(def.inputSchema.required, ["matter_id"]);
  assert.equal(def.inputSchema.additionalProperties, false);
});

test("get_bill_attachments returns the files and drops the always-null binary field", async () => {
  mockFetch([CHARTS]);
  const res = await handleLiveTool("get_bill_attachments", { matter_id: 79177 }, TOKEN);
  assert.ok(!res.isError);
  const rows = JSON.parse(res.content[0].text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].MatterAttachmentName, "Charts for Resolution");
  assert.equal(rows[0].MatterAttachmentHyperlink, CHARTS.MatterAttachmentHyperlink);
  assert.ok(!("MatterAttachmentBinary" in rows[0]));
});

test("a matter with no attachments returns []", async () => {
  mockFetch([]);
  const res = await handleLiveTool("get_bill_attachments", { matter_id: 79717 }, TOKEN);
  assert.deepEqual(JSON.parse(res.content[0].text), []);
});

// Opt-in live check: LEGISTAR_LIVE_URL_TEST=1 LEGISTAR_TOKEN=… npm test
test(
  "live: Res 0551-2026 returns its 7 files incl. Charts for Resolution",
  { skip: !(process.env.LEGISTAR_LIVE_URL_TEST && process.env.LEGISTAR_TOKEN) },
  async () => {
    global.fetch = realFetch; // earlier tests in this file mock it
    const rows = await getMatterAttachments(process.env.LEGISTAR_TOKEN, 79177);
    assert.equal(rows.length, 7);
    assert.ok(rows.some((r) => r.MatterAttachmentHyperlink === CHARTS.MatterAttachmentHyperlink));
  }
);
