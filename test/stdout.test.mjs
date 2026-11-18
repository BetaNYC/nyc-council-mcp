// In server mode, stdout carries only MCP messages; diagnostics go to stderr (#93). A stray
// console.log on stdout corrupts the JSON-RPC stream an AI app reads. Starts the built server in
// live-only mode (a fake token: no request is made at startup or for these calls) and in
// local-only mode, speaks JSON-RPC over stdio, and fails on any stdout line that is not a
// JSON-RPC 2.0 message.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

import { CREATE_TABLES } from "../dist/db/schema.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

async function session(env) {
  const child = spawn(process.execPath, [join(ROOT, "dist/index.js")], { env, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  const lines = () => out.split("\n").filter(Boolean);
  const until = async (n) => {
    for (let i = 0; i < 200 && lines().length < n; i++) await new Promise((r) => setTimeout(r, 25));
  };
  send({ id: 1, method: "initialize", params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "stdout-test", version: "0" } } });
  await until(1);
  send({ method: "notifications/initialized" });
  send({ id: 2, method: "tools/list" });
  send({ id: 3, method: "tools/call", params: { name: "about_betanyc", arguments: {} } });
  send({ id: 4, method: "tools/call", params: { name: "no_such_tool", arguments: {} } });
  await until(4);
  child.kill();
  return { lines: lines(), stderr: err };
}

for (const [mode, makeEnv] of [
  ["live-only", () => ({ LEGISTAR_TOKEN: "fake-token-for-stdout-test" })],
  ["local-only", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "council-stdout-")), "legistar.db");
    const db = new Database(dbPath);
    db.exec(CREATE_TABLES);
    db.close();
    return { LEGISTAR_DB_PATH: dbPath };
  }],
]) {
  test(`${mode}: every stdout line is a JSON-RPC message; the mode line goes to stderr`, async () => {
    const env = { ...process.env, ...makeEnv() };
    if (mode === "local-only") delete env.LEGISTAR_TOKEN;
    else delete env.LEGISTAR_DB_PATH;
    const { lines, stderr } = await session(env);
    assert.equal(lines.length, 4, `expected 4 answers, got: ${lines.join("\n")}`);
    for (const line of lines) {
      const msg = JSON.parse(line);
      assert.equal(msg.jsonrpc, "2.0", line);
      assert.ok("id" in msg, line);
    }
    assert.match(stderr, new RegExp(`nyc-council-mcp: ${mode} mode`));
  });
}
