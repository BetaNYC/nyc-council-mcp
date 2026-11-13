#!/usr/bin/env node
// Refresh the vendored council member terms (#28, tier 2).
//
// Source: NYC Open Data uvw5-9znb, "City Council Members (1999 to Present)".
// Rows are stored exactly as the City publishes them (sorted for stable diffs),
// with the fetch time and the dataset's own last-updated time. The indexer
// reads this file; nothing fetches it at index or query time.
//
//   node scripts/refresh-member-terms.mjs [out-path]

import { writeFileSync } from "node:fs";

const DATASET = "uvw5-9znb";
const BASE = "https://data.cityofnewyork.us";
const out = process.argv[2] ?? new URL("../data/council-member-terms.json", import.meta.url);

async function get(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const meta = await get(`${BASE}/api/views/${DATASET}.json`);
const rows = await get(`${BASE}/resource/${DATASET}.json?$limit=50000&$order=office_id`);
if (!Array.isArray(rows) || rows.length < 500) {
  throw new Error(`Expected 500+ rows from ${DATASET}, got ${Array.isArray(rows) ? rows.length : typeof rows}`);
}
rows.sort((a, b) => Number(a.office_id) - Number(b.office_id));

const snapshot = {
  dataset: DATASET,
  name: meta.name,
  url: `${BASE}/d/${DATASET}`,
  fetched_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  rows_updated_at: meta.rowsUpdatedAt ? new Date(meta.rowsUpdatedAt * 1000).toISOString().replace(/\.\d{3}Z$/, "Z") : null,
  rows,
};
writeFileSync(out, JSON.stringify(snapshot, null, 1) + "\n");
console.error(`Wrote ${rows.length} rows from ${DATASET} to ${out}`);
