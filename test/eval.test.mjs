// The evaluation set (#88): its shape, and the questions the shipped data can answer, run
// offline in CI. The questions that need the archive run with `npm run eval` and a local index.

import { test } from "node:test";
import assert from "node:assert/strict";

import { QUESTIONS, run, score } from "../scripts/eval.mjs";
import { LOCAL_TOOL_DEFS } from "../dist/tools/local.js";

const TOOLS = new Set(LOCAL_TOOL_DEFS.map((t) => t.name));

test("at least 10 questions, each with a known answer and where it came from", () => {
  assert.ok(QUESTIONS.length >= 10);
  assert.equal(new Set(QUESTIONS.map((q) => q.id)).size, QUESTIONS.length, "ids are unique");
  for (const q of QUESTIONS) {
    assert.ok(q.q && q.answer_source && Object.keys(q.check).length, q.id);
    assert.ok(["bundled", "index"].includes(q.needs), q.id);
    assert.ok(TOOLS.has(q.tool), `${q.id}: ${q.tool}`);
  }
});

test("the questions the shipped data can answer all pass", async () => {
  const { mode, results } = await run({ dbPath: "" });
  assert.equal(mode, "bundled");
  const ran = results.filter((r) => r.status !== "skipped");
  assert.ok(ran.length >= 5);
  for (const r of ran) assert.equal(r.status, "pass", `${r.q.id}: ${JSON.stringify(r.checks)}`);
});

test("a wrong answer fails its check", () => {
  const q = { check: { field: ["member.full_name", "Somebody Else"] } };
  const res = { content: [{ type: "text", text: JSON.stringify({ member: { full_name: "Christopher Marte" } }) }] };
  assert.equal(score(q, res)[0][1], false);
  assert.equal(score(q, { isError: true, content: [{ type: "text", text: "x" }] })[0][1], false);
});
