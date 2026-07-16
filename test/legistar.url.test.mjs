// Regression tests for legistarUrl — the intro.nyc link builder.
//
// Run with:  npm test   (builds first, then `node --test`)
//
// WHY these cases: NYC's OData ids != website ids, so we cannot build a
// LegislationDetail.aspx link. intro.nyc redirects `/{NNNN-YYYY}` to the right
// page but keys on the bare number and ASSUMES type = Introduction (verified
// 2026-07-16: intro.nyc/0232-2024.json returns File "Int 0232-2024"). So an
// intro.nyc link is emitted ONLY for Introductions; every other type (Res, LU,
// M, T, …) must return null, because a wrong link is worse than no link.

import { test } from "node:test";
import assert from "node:assert/strict";

import { legistarUrl } from "../dist/legistar.js";

test("Introduction file → intro.nyc link", () => {
  // The one verified-working case (Int 0976-2026 → OData MatterId 78436,
  // website ID 8138338 — proof the ids differ and only intro.nyc bridges them).
  assert.equal(legistarUrl("Int 0976-2026"), "https://intro.nyc/0976-2026");
});

test("Resolution file → no link (intro.nyc is Introduction-only)", () => {
  assert.equal(legistarUrl("Res 0232-2024"), null);
});

test("Land Use Call-Up (M) file → no link (would misroute to same-numbered Int)", () => {
  // The core hazard: intro.nyc/0052-2026 resolves to Int 0052-2026, NOT
  // M 0052-2026. Emitting a link here would point at the wrong bill.
  assert.equal(legistarUrl("M 0052-2026"), null);
});

test("Land Use (LU) file → no link", () => {
  assert.equal(legistarUrl("LU 0123-2025"), null);
});

test("null / empty / malformed input → null", () => {
  assert.equal(legistarUrl(null), null);
  assert.equal(legistarUrl(undefined), null);
  assert.equal(legistarUrl(""), null);
  assert.equal(legistarUrl("Int"), null);
  assert.equal(legistarUrl("0976-2026"), null); // bare number, no type prefix — don't assume Introduction
});

test("case-insensitive prefix and surrounding whitespace tolerated", () => {
  assert.equal(legistarUrl("int 0976-2026"), "https://intro.nyc/0976-2026");
  assert.equal(legistarUrl("  Int 0976-2026  "), "https://intro.nyc/0976-2026");
});
