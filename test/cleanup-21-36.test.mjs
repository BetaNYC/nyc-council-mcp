// Cleanup from #36 (what still applied from stale PR #7) and #21.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";

import { archiveJsonFiles } from "../dist/db/indexer.js";
import { LOCAL_TOOL_DEFS } from "../dist/tools/local.js";

test("#36: fast-glob is no longer a dependency", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(!("fast-glob" in (pkg.dependencies ?? {})));
});

test("#36: archiveJsonFiles walks .json files, recursive or not, absolute paths", () => {
  // A parenthesis and brackets in the path: glob syntax that broke #12.
  const root = mkdtempSync(join(tmpdir(), "arch (x86) [1]-"));
  const put = (rel) => {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), "{}");
  };
  put("people/a.json");
  put("people/nested/b.json");
  put("introduction/2026/c.json");
  put("introduction/2026/deep/d.json");
  put("introduction/2026/readme.txt");

  const people = archiveJsonFiles(root, "people", false);
  assert.deepEqual(people, [join(root, "people", "a.json")]);

  const intros = archiveJsonFiles(root, "introduction", true);
  assert.deepEqual(intros, [
    join(root, "introduction", "2026", "c.json"),
    join(root, "introduction", "2026", "deep", "d.json"),
  ]);
  assert.ok(intros.every(isAbsolute));
  assert.deepEqual(archiveJsonFiles(root, "events", true), []);
});

test("#21: search_legislation is the main name; search_bills is the alias", () => {
  const leg = LOCAL_TOOL_DEFS.find((t) => t.name === "search_legislation");
  const bills = LOCAL_TOOL_DEFS.find((t) => t.name === "search_bills");
  assert.doesNotMatch(leg.description, /^Alias/);
  assert.match(leg.description, /Resolutions/);
  assert.match(bills.description, /^Alias for search_legislation/);
  assert.deepEqual(bills.inputSchema, leg.inputSchema);
});
