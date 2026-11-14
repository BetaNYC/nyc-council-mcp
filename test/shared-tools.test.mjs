// whats_changed and about_betanyc (#75): BetaNYC's What's changed standard
// (betanyc-ai-workspace platform/system/whats-changed-standard.md § 7). Both come from the
// shared module (src/betanyc-tools.ts, a copy of the workspace's canonical file: never edit it
// here), wired in src/server.ts beside about_data with no wrapper of this repo's own.
//
// These tests call the tools the way an AI app does: the built server over stdio, through the
// server's own CallTool handler. The MCP SDK client checks each structuredContent against the
// tool's declared outputSchema. No test here makes a network call: listing tools and calling
// the three shared tools never reach Legistar, even with a token set.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { SHARED_MODULE_VERSION, BETANYC_TOOLS, parseWhatsChanged } from "../dist/betanyc-tools.js";
import { betanycTools, SERVER_INSTRUCTIONS } from "../dist/server.js";
import { LOCAL_TOOL_DEFS } from "../dist/tools/local.js";
import { LIVE_TOOL_DEFS, LIVE_SEARCH_TOOL_DEF } from "../dist/tools/live.js";
import { CREATE_TABLES } from "../dist/db/schema.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const WC_TEXT = readFileSync(join(ROOT, "WHATS-CHANGED.md"), "utf8");
const REPO = "https://github.com/BetaNYC/nyc-council-mcp";

function tempIndex() {
  const dir = mkdtempSync(join(tmpdir(), "council-shared-"));
  const dbPath = join(dir, "legistar.db");
  const db = new Database(dbPath);
  db.exec(CREATE_TABLES);
  db.close();
  return dbPath;
}

/** Start the built server over stdio. `token` is a dummy: nothing here calls a live tool. */
async function connect({ index = true, token = null } = {}) {
  const env = { ...process.env };
  delete env.LEGISTAR_TOKEN;
  delete env.LEGISTAR_DB_PATH;
  if (index) env.LEGISTAR_DB_PATH = tempIndex();
  if (token) env.LEGISTAR_TOKEN = token;
  const client = new Client({ name: "shared-tools-test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "dist/index.js")], env, stderr: "ignore" }));
  return client;
}

test("hybrid mode lists every tool once, the three shared tools included", async () => {
  const client = await connect({ index: true, token: "dummy-token-not-used" });
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    const expected = new Set([
      ...LOCAL_TOOL_DEFS.map((t) => t.name),
      ...LIVE_TOOL_DEFS.map((t) => t.name),
      LIVE_SEARCH_TOOL_DEF.name,
      "whats_changed",
      "about_betanyc",
      "about_data",
    ]);
    assert.equal(names.length, new Set(names).size, "no tool is listed twice");
    assert.deepEqual(new Set(names), expected);
    assert.equal(names.length, 28, "2.8.0 listed 26 tools in hybrid mode; 2.9.0 adds two");
  } finally {
    await client.close();
  }
});

test("the shared tools are listed in local-only and live-only mode too", async () => {
  for (const mode of [{ index: true }, { index: false, token: "dummy-token-not-used" }]) {
    const client = await connect(mode);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      for (const n of ["whats_changed", "about_betanyc", "about_data"]) assert.ok(names.includes(n), `${n} in ${JSON.stringify(mode)}`);
    } finally {
      await client.close();
    }
  }
});

test("whats_changed over MCP stdio answers from WHATS-CHANGED.md", async () => {
  const client = await connect();
  try {
    const res = await client.callTool({ name: "whats_changed", arguments: {} });
    assert.ok(!res.isError);
    const body = res.structuredContent;
    assert.deepEqual(body.server, { name: "nyc-council-mcp", version: PKG.version });
    assert.equal(body.source, `${REPO}/blob/HEAD/WHATS-CHANGED.md`);
    assert.match(body.history_begins, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(body.returned > 0 && body.entries.length === body.returned);
    for (const e of body.entries) {
      assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, "an Unreleased entry is never returned");
      assert.ok(e.url.startsWith(`${REPO}/blob/HEAD/WHATS-CHANGED.md#`), e.url);
      for (const l of e.links) assert.match(l.url, /^https:\/\//, "every link is absolute");
    }
    // No entry in the shipped file has an error, so none is left out for one.
    assert.doesNotMatch(body.note ?? "", /errors and/);
    assert.match(res.content[0].text, /What's changed in nyc-council-mcp/);

    const corrections = await client.callTool({ name: "whats_changed", arguments: { tag: "correction", limit: 50 } });
    assert.ok(corrections.structuredContent.entries.length > 0);
    for (const e of corrections.structuredContent.entries) {
      assert.ok(e.tags.includes("Correction"));
      assert.ok(e.if_you_used_the_old_numbers, `${e.title} says what to re-check`);
    }

    const bad = await client.callTool({ name: "whats_changed", arguments: { since: "last week" } });
    assert.equal(bad.isError, true, "a bad argument is an error");
    const unknown = await client.callTool({ name: "whats_changed", arguments: { bogus: 1 } });
    assert.equal(unknown.isError, true);
    assert.match(unknown.content[0].text, /bogus/);
  } finally {
    await client.close();
  }
});

test("about_betanyc over MCP stdio says who built the server, with module version 1.3.6", async () => {
  const client = await connect({ index: false, token: "dummy-token-not-used" });
  try {
    const res = await client.callTool({ name: "about_betanyc", arguments: {} });
    assert.ok(!res.isError);
    const body = res.structuredContent;
    assert.deepEqual(body.server, {
      name: "nyc-council-mcp",
      version: PKG.version,
      repository: REPO,
      shared_module_version: "1.3.6",
    });
    assert.equal(SHARED_MODULE_VERSION, "1.3.6");
    assert.equal(body.built_by, "BetaNYC, a project of the Fund for the City of New York");
    assert.deepEqual(body.bugs_and_requests, { issues: `${REPO}/issues`, new_issue: `${REPO}/issues/new` });
    assert.equal(body.whats_changed, `${REPO}/blob/HEAD/WHATS-CHANGED.md`);
    assert.match(res.content[0].text, /nyc-council-mcp .* was built by BetaNYC/);
    assert.equal((await client.callTool({ name: "about_betanyc", arguments: { x: 1 } })).isError, true);
  } finally {
    await client.close();
  }
});

test("the server instructions point at all three shared tools", async () => {
  assert.match(SERVER_INSTRUCTIONS, /call about_data/);
  assert.match(SERVER_INSTRUCTIONS, /call about_betanyc/);
  assert.match(SERVER_INSTRUCTIONS, /call whats_changed/);
  const client = await connect();
  try {
    assert.equal(client.getInstructions(), SERVER_INSTRUCTIONS);
  } finally {
    await client.close();
  }
});

test("the shared tools are the module's own definitions, with no wrapper of this repo's own", () => {
  const shared = betanycTools({ db: null, hasLive: false, version: PKG.version });
  for (const name of ["whats_changed", "about_betanyc"]) {
    const ours = shared.tools.find((t) => t.name === name);
    const theirs = BETANYC_TOOLS.find((t) => t.name === name);
    assert.deepEqual(ours, theirs, name);
  }
  const aboutData = shared.tools.find((t) => t.name === "about_data");
  assert.deepEqual(aboutData.outputSchema, BETANYC_TOOLS.find((t) => t.name === "about_data").outputSchema, "about_data's output is the module's");
  assert.ok(shared.handles("whats_changed") && shared.handles("about_betanyc") && shared.handles("about_data"));
  assert.ok(!shared.handles("get_bill"));
});

test("WHATS-CHANGED.md parses with no errors, and its MCP entry names this version", () => {
  const parsed = parseWhatsChanged(WC_TEXT);
  assert.deepEqual(parsed.errors, []);
  assert.ok(parsed.entries.every((e) => e.valid), "every entry is valid");
  assert.ok(parsed.history_begins);
  const named = parsed.entries.filter((e) => e.tags.includes("MCP") && (e.mcp_version ?? "").includes(`nyc-council-mcp ${PKG.version}`));
  assert.equal(named.length, 1, `one MCP entry names ${PKG.version}`);
});

test("the package ships WHATS-CHANGED.md", () => {
  assert.ok(PKG.files.includes("WHATS-CHANGED.md"));
});
