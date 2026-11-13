// Matter attributes from the archive (#31): full text and summary in search,
// Local Law number and version as fields, attachments as a table, and the new
// local get_matter tool. Built through the real buildIndex over a temp archive
// shaped like jehiah/nyc_legislation (field names checked against
// introduction/2024/1122.json on 2026-11-12).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { buildIndex } from "../dist/db/indexer.js";
import { searchBills, getMatter } from "../dist/db/queries.js";
import { SCHEMA_VERSION } from "../dist/db/schema.js";
import { handleLocalTool } from "../dist/tools/local.js";

const attachments = (n, first) =>
  Array.from({ length: n }, (_, i) => ({
    ID: 300000 + i,
    LastModified: "2025-12-08T22:03:56.38Z",
    Name: i === 0 ? first[0] : i === 1 ? first[1] : `Attachment ${i}`,
    Link: `https://nyc.legistar1.com/nyc/attachments/${i}.docx`,
    Sort: i + 1,
  }));

const MATTERS = {
  "introduction/2024/1122.json": {
    ID: 72178, File: "Int 1122-2024", Name: "Internet master plan", TypeName: "Introduction",
    Title: "Requiring an internet master plan", Version: "A", LocalLaw: "2025/153",
    Summary: "This bill would require a plan for low-cost access to broadband.",
    Text: "Section 1. The department shall publish a zephyrine connectivity roadmap.",
    Sponsors: [{ ID: 1, FullName: "Jennifer Gutiérrez" }],
    Attachments: attachments(22, ["Summary of Int. No. 1122-A", "Int. No. 1122"]),
  },
  "resolution/2026/0551.json": {
    ID: 79177, File: "Res 0551-2026", Name: "Transparency resolution", TypeName: "Resolution",
    Title: "Resolution approving changes", Version: "*", LocalLaw: null, Summary: "",
    Text: "RESOLVED, that the quillwort schedule is adopted.",
    Attachments: attachments(7, ["Charts for Resolution", "Committee Report"]),
  },
  "land_use/2026/0100.json": {
    ID: 79300, File: "LU 0100-2026", Name: "Zoning", TypeName: "Land Use Application",
    Title: "Zoning map amendment", Version: "*", Summary: "",
    Text: "Application concerning the marrowfat block.", Attachments: [],
  },
  "introduction/2023/0001.json": {
    ID: 70001, File: "Int 0001-2023", Name: "No text", TypeName: "Introduction",
    Title: "A bill with no body text yet", Version: "*", LocalLaw: null, Summary: "", Text: null,
    Attachments: [],
  },
  "introduction/2023/0002.json": {
    ID: 70002, File: "Int 0002-2023", Name: "Huge", TypeName: "Introduction",
    Title: "A very long bill", Version: "*", Summary: "",
    Text: "lorem ipsum ".repeat(20000) + "the tamarack clause",
    Attachments: [],
  },
};

function archive() {
  const root = mkdtempSync(join(tmpdir(), "legistar-attrs-"));
  for (const [rel, m] of Object.entries(MATTERS)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), JSON.stringify(m));
  }
  return root;
}

async function built() {
  const root = archive();
  const dbPath = join(root, "t.db");
  await buildIndex({ archiveRoot: root, dbPath, full: true });
  return { root, dbPath, db: new Database(dbPath, { readonly: true }) };
}

const files = (rows) => rows.map((r) => r.file_number).sort();

test("schema version is 6, so existing corpora rebuild in full", () => {
  assert.equal(SCHEMA_VERSION, 6);
});

test("a phrase only in the body text is found", async () => {
  const { db } = await built();
  assert.deepEqual(files(searchBills(db, "zephyrine connectivity")), ["Int 1122-2024"]);
  assert.deepEqual(files(searchBills(db, "quillwort")), ["Res 0551-2026"]);
  assert.deepEqual(files(searchBills(db, "marrowfat")), ["LU 0100-2026"]);
  db.close();
});

test("a phrase only in the summary is found", async () => {
  const { db } = await built();
  assert.deepEqual(files(searchBills(db, "low-cost broadband")), ["Int 1122-2024"]);
  db.close();
});

test("title and sponsor search still work, including a matter with no text", async () => {
  const { db } = await built();
  assert.deepEqual(files(searchBills(db, "internet master plan")), ["Int 1122-2024"]);
  assert.deepEqual(files(searchBills(db, "body text")), ["Int 0001-2023"]);
  assert.deepEqual(files(searchBills(db, "Gutiérrez")), ["Int 1122-2024"]);
  db.close();
});

test("a 240,000-character text indexes and is searchable", async () => {
  const { db } = await built();
  assert.deepEqual(files(searchBills(db, "tamarack clause")), ["Int 0002-2023"]);
  db.close();
});

test("search rows carry version and local_law; null, never empty string", async () => {
  const { db } = await built();
  const [int] = searchBills(db, "zephyrine");
  assert.equal(int.version, "A");
  assert.equal(int.local_law, "2025/153");
  const [res] = searchBills(db, "quillwort");
  assert.equal(res.local_law, null);
  db.close();
});

test("get_matter by file number: summary, version, Local Law, attachments", async () => {
  const { db } = await built();
  const m = getMatter(db, { file_number: "Int 1122-2024" });
  assert.equal(m.local_law, "2025/153");
  assert.equal(m.version, "A");
  assert.match(m.summary, /low-cost access to broadband/);
  assert.equal(m.attachments.length, 22);
  assert.deepEqual(m.attachments.slice(0, 2).map((a) => a.name), ["Summary of Int. No. 1122-A", "Int. No. 1122"]);
  assert.equal(m.attachments[0].link, "https://nyc.legistar1.com/nyc/attachments/0.docx");
  assert.equal(m.legistar_url, "https://legistar.council.nyc.gov/gateway.aspx?M=L&ID=72178");
  assert.ok(!("text" in m), "text only on request");
  db.close();
});

test("get_matter by Local Law number resolves to the bill", async () => {
  const { db } = await built();
  assert.equal(getMatter(db, { local_law: "2025/153" }).file_number, "Int 1122-2024");
  assert.equal(getMatter(db, { local_law: "1999/999" }), null);
  db.close();
});

test("get_matter: no attachments is [], empty summary is null, text on request", async () => {
  const { db } = await built();
  const lu = getMatter(db, { file_number: "LU 0100-2026", include_text: true });
  assert.deepEqual(lu.attachments, []);
  assert.equal(lu.summary, null);
  assert.match(lu.text, /marrowfat/);
  db.close();
});

test("re-indexing does not duplicate attachments", async () => {
  const { root, dbPath, db } = await built();
  db.close();
  // Touch every file so an incremental run re-reads them all.
  const later = new Date(Date.now() + 60_000);
  for (const rel of Object.keys(MATTERS)) utimesSync(join(root, rel), later, later);
  await buildIndex({ archiveRoot: root, dbPath, full: false });
  await buildIndex({ archiveRoot: root, dbPath, full: true });
  const d = new Database(dbPath, { readonly: true });
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM matter_attachments").get().n, 29);
  d.close();
});

test("get_matter tool: needs exactly one of file_number or local_law", async () => {
  const { db } = await built();
  const ok = handleLocalTool("get_matter", { local_law: "2025/153" }, db);
  assert.ok(!ok.isError);
  assert.equal(JSON.parse(ok.content[0].text).file_number, "Int 1122-2024");
  assert.ok(handleLocalTool("get_matter", {}, db).isError);
  assert.ok(handleLocalTool("get_matter", { file_number: "Int 1122-2024", local_law: "2025/153" }, db).isError);
  const missing = handleLocalTool("get_matter", { file_number: "Int 9999-2099" }, db);
  assert.ok(missing.isError);
  db.close();
});
