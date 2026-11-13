// Curated member facts (#28 layers 3 and 4, #37): Wikidata/Wikipedia, party
// as ballot lines, and office social accounts. These are BetaNYC's hand-checked
// assertions, not official records, and every answer must say so. Each fact
// carries its source and check date. A member with no curated row gets null,
// never a guess, and party is never filled from a caucus.
//
// Party is every ballot line the member won on (NYC fusion voting: Noel,
// 2026-11-12), from NYC Board of Elections certified results.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadCurated, curatedFor, withCurated, CURATED_LABEL } from "../dist/curated.js";

const file = (rows) => ({ curated_by: "BetaNYC", official: false, checked_at: "2026-11-12", rows });

function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), "curated-"));
  writeFileSync(join(dir, "council-wikidata.json"), JSON.stringify(file([
    { district: 6, person_id: 5259, name: "Gale A. Brewer", wikidata_qid: "Q5518265",
      wikipedia_url: "https://en.wikipedia.org/wiki/Gale_Brewer", method: "m", evidence: "e", checked_at: "2026-11-12", status: "verified", reviewed_by: null },
  ])));
  writeFileSync(join(dir, "council-party.json"), JSON.stringify(file([
    { district: 6, person_id: 5259, name: "Gale A. Brewer", election: "2025-11-04 general",
      ballot_lines: [{ line: "Democratic", votes: 50000 }, { line: "Working Families", votes: 6000 }],
      total_votes: 56000, uncontested: false, source_url: "https://vote.nyc/x.pdf", source_title: "t",
      certified: true, checked_at: "2026-11-12", status: "verified", notes: "" },
    { district: 7, person_id: 9999, name: "Not Found", election: "2025-11-04 general", ballot_lines: [],
      source_url: null, checked_at: "2026-11-12", status: "none", notes: "" },
  ])));
  writeFileSync(join(dir, "council-social.json"), JSON.stringify(file([
    { district: 6, person_id: 5259, name: "Gale A. Brewer",
      accounts: { bluesky: { handle: "galebrewer.bsky.social", url: "https://bsky.app/profile/galebrewer.bsky.social", account_type: "office",
        source_url: "https://council.nyc.gov/district-6/", method: "council.nyc.gov district page link", checked_at: "2026-11-12", status: "verified" },
        instagram: null, threads: null, linkedin: null }, notes: "" },
  ])));
  return dir;
}

test("a curated member gets every layer, each labeled not official", () => {
  const c = curatedFor(5259, loadCurated(fixtureDir()));
  assert.equal(c.label, CURATED_LABEL);
  assert.match(c.label, /not an official record/);
  assert.equal(c.wikidata.qid, "Q5518265");
  assert.equal(c.wikidata.wikipedia_url, "https://en.wikipedia.org/wiki/Gale_Brewer");
  assert.deepEqual(c.party.ballot_lines.map((l) => l.line), ["Democratic", "Working Families"]);
  assert.equal(c.party.source_url, "https://vote.nyc/x.pdf");
  assert.equal(c.party.checked_at, "2026-11-12");
  assert.equal(c.social.bluesky.handle, "galebrewer.bsky.social");
  assert.equal(c.social.instagram, null);
});

test("fusion: every ballot line is kept, in order", () => {
  const c = curatedFor(5259, loadCurated(fixtureDir()));
  assert.equal(c.party.ballot_lines.length, 2);
  assert.equal(c.party.ballot_lines[1].votes, 6000);
});

test("no curated row means null, never a guess", () => {
  const c = curatedFor(1, loadCurated(fixtureDir()));
  assert.equal(c.wikidata, null);
  assert.equal(c.party, null);
  assert.equal(c.social, null);
});

test("a 'none' party row is null, not an empty party", () => {
  assert.equal(curatedFor(9999, loadCurated(fixtureDir())).party, null);
});

test("missing files load as empty, without throwing", () => {
  const c = curatedFor(5259, loadCurated(mkdtempSync(join(tmpdir(), "curated-empty-"))));
  assert.equal(c.wikidata, null);
});

test("withCurated adds a curated block to a list of people, leaves errors alone", () => {
  const curated = loadCurated(fixtureDir());
  const res = { content: [{ type: "text", text: JSON.stringify([{ PersonId: 5259 }, { person_id: 1 }]) }] };
  const out = JSON.parse(withCurated(res, curated).content[0].text);
  assert.equal(out[0].curated.party.ballot_lines[0].line, "Democratic");
  assert.equal(out[1].curated.party, null);
  const err = { content: [{ type: "text", text: "Error" }], isError: true };
  assert.equal(withCurated(err, curated), err);
});

test("the shipped files: 51 members each, joined on person_id, sources on every row", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  for (const f of ["council-wikidata.json", "council-party.json", "council-social.json"]) {
    assert.ok(pkg.files.includes(`data/${f}`), `${f} ships`);
    const data = JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url)));
    assert.equal(data.official, false, f);
    assert.equal(data.rows.length, 51, f);
    assert.equal(new Set(data.rows.map((r) => r.person_id)).size, 51, f);
    assert.deepEqual(data.rows.map((r) => r.district), Array.from({ length: 51 }, (_, i) => i + 1), f);
  }
  const party = JSON.parse(readFileSync(new URL("../data/council-party.json", import.meta.url)));
  for (const r of party.rows) {
    if (r.status === "none") continue;
    assert.ok(r.source_url, `party source for district ${r.district}`);
    assert.ok(r.ballot_lines.length >= 1, `lines for district ${r.district}`);
  }
  const wd = JSON.parse(readFileSync(new URL("../data/council-wikidata.json", import.meta.url)));
  assert.equal(wd.rows.find((r) => r.district === 3).person_id, 7874, "District 3 is Carl Wilson, not Bottcher");
  const social = JSON.parse(readFileSync(new URL("../data/council-social.json", import.meta.url)));
  for (const r of social.rows) for (const a of Object.values(r.accounts)) {
    if (a) assert.equal(a.account_type, "office", `district ${r.district}: office accounts only`);
  }
});
