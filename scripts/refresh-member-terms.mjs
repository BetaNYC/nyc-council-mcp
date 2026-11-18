#!/usr/bin/env node
// Refresh the vendored council member terms (#28, tier 2).
//
// Source: NYC Open Data uvw5-9znb, "City Council Members (1999 to Present)".
// Rows are stored exactly as the City publishes them (sorted for stable diffs),
// with the fetch time and the dataset's own last-updated time. The indexer
// reads this file; nothing fetches it at index or query time.
//
//   node scripts/refresh-member-terms.mjs [out-path]

import { readFileSync, writeFileSync } from "node:fs";

const DATASET = "uvw5-9znb";
const BASE = "https://data.cityofnewyork.us";
const out = process.argv[2] ?? new URL("../data/council-member-terms.json", import.meta.url);

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const USER_AGENT = `@betanyc/nyc-council-mcp/${VERSION} (+https://github.com/BetaNYC/nyc-council-mcp)`;
// 60 s, not the server's 30 s: the rows request returns every council term since 1999 in one
// response, and this runs unattended once a month, where waiting longer costs nothing (#83).
const TIMEOUT_MS = 60_000;

// One GET with a timeout and a User-Agent, retried at most twice on 429 or 5xx, waiting what
// Retry-After says (delay-seconds) or 5 s, at most 60 s (#83). No key is sent.
async function get(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return res.json();
    const retryAfter = Number(res.headers.get("retry-after"));
    if ((res.status === 429 || res.status >= 500) && attempt <= 2) {
      await new Promise((r) => setTimeout(r, Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000, 60_000)));
      continue;
    }
    throw new Error(`${url}: HTTP ${res.status}`);
  }
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
