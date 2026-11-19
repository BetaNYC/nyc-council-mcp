#!/usr/bin/env node
// The evaluation set (#88): eval/questions.json, scored against this server's local tools.
//
//   npm run eval                    with LEGISTAR_DB_PATH: every question, against your index
//                                   without it: the `bundled` questions, against an index built
//                                   from data/council-member-terms.json alone; the rest skip
//   npm run eval -- --save          also write eval/runs/YYYY-MM-DD-<mode>.md
//
// Offline: local tools only, no token, no network. Exit 1 if any question that ran failed.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { handleLocalTool } from "../dist/tools/local.js";
import { buildIndex } from "../dist/db/indexer.js";
import { nyDateString } from "../dist/dates.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const QUESTIONS = JSON.parse(readFileSync(join(ROOT, "eval/questions.json"), "utf8")).questions;

const at = (obj, path) => (path ? path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj) : obj);

/** The checks a question asks for, each [name, passed, detail]. */
export function score(q, res) {
  if (res.isError) return [["answered", false, res.content[0]?.text ?? ""]];
  const all = res.content.map((c) => c.text).join("\n");
  let json;
  try { json = JSON.parse(res.content[0].text); } catch { json = undefined; }
  const out = [];
  const c = q.check;
  if (c.field) out.push(["field", at(json, c.field[0]) === c.field[1], `${c.field[0]} = ${JSON.stringify(at(json, c.field[0]))}`]);
  if (c.not_field) out.push(["not_field", at(json, c.not_field[0]) !== c.not_field[1], `${c.not_field[0]} = ${JSON.stringify(at(json, c.not_field[0]))}`]);
  if (c.text) out.push(["text", new RegExp(c.text).test(all), `/${c.text}/`]);
  if (c.some) {
    const arr = at(json, c.some.path);
    const ok = Array.isArray(arr) && arr.some((e) => Object.entries(c.some.where).every(([k, v]) => at(e, k) === v));
    out.push(["some", ok, `${c.some.path || "(root)"} has ${JSON.stringify(c.some.where)}`]);
  }
  return out;
}

/** An index built from the shipped terms file alone (one placeholder matter: the indexer needs one). */
export async function bundledIndex() {
  const root = mkdtempSync(join(tmpdir(), "council-eval-"));
  mkdirSync(join(root, "resolution", "2026"), { recursive: true });
  writeFileSync(join(root, "resolution", "2026", "0001.json"), JSON.stringify({ ID: 1, File: "Res 0001-2026", Title: "placeholder", TypeName: "Resolution", History: [] }));
  const dbPath = join(root, "eval.db");
  await buildIndex({ archiveRoot: root, dbPath, full: true, termsPath: join(ROOT, "data/council-member-terms.json") });
  return new Database(dbPath, { readonly: true });
}

export async function run({ dbPath = process.env.LEGISTAR_DB_PATH } = {}) {
  const full = Boolean(dbPath && existsSync(dbPath));
  const db = full ? new Database(dbPath, { readonly: true, fileMustExist: true }) : await bundledIndex();
  const results = QUESTIONS.map((q) => {
    if (!full && q.needs !== "bundled") return { q, status: "skipped", checks: [] };
    const checks = score(q, handleLocalTool(q.tool, q.args, db));
    return { q, status: checks.every(([, ok]) => ok) ? "pass" : "fail", checks };
  });
  const state = full ? Object.fromEntries(db.prepare("SELECT key, value FROM index_state").all().map((r) => [r.key, r.value])) : {};
  db.close();
  return { mode: full ? "index" : "bundled", state, results };
}

export function report({ mode, state, results }) {
  const n = (s) => results.filter((r) => r.status === s).length;
  const lines = [
    `# Evaluation run, ${nyDateString()} (${mode})`,
    "",
    mode === "index"
      ? `Index built ${state.last_indexed_at ?? "?"} from jehiah/nyc_legislation@${state.archive_commit ?? "?"}; council terms fetched ${state.member_terms_fetched_at ?? "?"}.`
      : "Bundled data only: an index built from data/council-member-terms.json. Questions that need the archive were skipped.",
    "",
    `**${n("pass")} passed, ${n("fail")} failed, ${n("skipped")} skipped** of ${results.length}.`,
    "",
    "| Id | Question | Result | Checks |",
    "|---|---|---|---|",
    ...results.map(({ q, status, checks }) =>
      `| ${q.id} | ${q.q.replace(/\|/g, "\\|")} | ${status} | ${checks.map(([k, ok, d]) => `${ok ? "✓" : "✗"} ${k}: ${String(d).replace(/\|/g, "\\|").slice(0, 160)}`).join("<br>")} |`),
  ];
  return lines.join("\n") + "\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = await run();
  const text = report(r);
  process.stdout.write(text);
  if (process.argv.includes("--save")) {
    const out = join(ROOT, "eval/runs", `${nyDateString()}-${r.mode}.md`);
    writeFileSync(out, text);
    console.error(`Wrote ${out}`);
  }
  process.exit(r.results.some((x) => x.status === "fail") ? 1 : 0);
}
