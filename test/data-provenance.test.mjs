// The data files that ship in the package say where they came from and when, and carry a
// checksum (#90). A hand edit to a curated file, or a refresh, must update data/SHA256SUMS
// (node scripts/data-checksums.mjs); this test fails when they disagree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { dataFiles, sumsText, SUMS, DATA_DIR } from "../scripts/data-checksums.mjs";

const read = (f) => JSON.parse(readFileSync(DATA_DIR + f, "utf8"));
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/.test(v);

test("data/SHA256SUMS matches every data file", () => {
  assert.equal(readFileSync(SUMS, "utf8").replace(/\r\n/g, "\n"), sumsText(), "run: node scripts/data-checksums.mjs");
  assert.deepEqual(dataFiles(), ["council-member-terms.json", "council-party.json", "council-social.json", "council-wikidata.json"]);
});

test("the council terms snapshot records its source, fetch date and the City's last update", () => {
  const t = read("council-member-terms.json");
  assert.equal(t.dataset, "uvw5-9znb");
  assert.equal(t.url, "https://data.cityofnewyork.us/d/uvw5-9znb");
  assert.ok(isDate(t.fetched_at) && isDate(t.rows_updated_at));
});

test("each curated file and each of its rows has a check date", () => {
  for (const f of ["council-party.json", "council-social.json", "council-wikidata.json"]) {
    const d = read(f);
    assert.ok(isDate(d.checked_at), f);
    assert.equal(d.official, false, f);
    for (const r of d.rows) if ("checked_at" in r) assert.ok(isDate(r.checked_at), `${f} ${r.person_id}`);
  }
});

test("the package ships the checksums with the data", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(pkg.files.includes("data/SHA256SUMS"));
});
