// Polite requests to the Legistar Web API (#83): a timeout, a User-Agent naming the package and
// version, and a bounded retry on 429 and 5xx that honors Retry-After. fetch is mocked; no
// network.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  legistarFetch, retryWaitMs, LegistarError, LEGISTAR_TIMEOUT_MS, LEGISTAR_MAX_RETRIES, LEGISTAR_MAX_WAIT_MS,
} from "../dist/legistar.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const URL_ = "https://webapi.legistar.com/v1/nyc/matters?token=T0K3N";
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const reply = (status, { body = "", headers = {} } = {}) =>
  new Response(status === 200 ? JSON.stringify([{ ok: 1 }]) : body, { status, headers });

function script(...answers) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    return typeof a === "function" ? a(init) : a;
  };
  return calls;
}
const waits = [];
const sleep = async (ms) => { waits.push(ms); };

test("every request names the package and version, and has a timeout signal", async () => {
  const calls = script(reply(200));
  await legistarFetch(URL_, { sleep });
  const ua = new Headers(calls[0].init.headers).get("user-agent");
  assert.equal(ua, `@betanyc/nyc-council-mcp/${VERSION} (+https://github.com/BetaNYC/nyc-council-mcp)`);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.ok(LEGISTAR_TIMEOUT_MS >= 15_000 && LEGISTAR_TIMEOUT_MS <= 30_000);
});

test("a request that runs past the timeout fails with a plain sentence", async () => {
  globalThis.fetch = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  await assert.rejects(legistarFetch(URL_, { timeoutMs: 20, sleep }), (e) => {
    assert.ok(e instanceof LegistarError);
    assert.match(e.message, /did not answer within 0\.02 seconds/);
    return true;
  });
});

test("429 with Retry-After is retried after the wait it asks for", async () => {
  waits.length = 0;
  const calls = script(reply(429, { headers: { "Retry-After": "3" } }), reply(200));
  assert.deepEqual(await legistarFetch(URL_, { sleep }), [{ ok: 1 }]);
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [3000]);
});

test("5xx is retried with backoff, at most LEGISTAR_MAX_RETRIES times", async () => {
  waits.length = 0;
  const calls = script(reply(503));
  await assert.rejects(legistarFetch(URL_, { sleep }), (e) => e instanceof LegistarError && e.status === 503);
  assert.equal(calls.length, LEGISTAR_MAX_RETRIES + 1);
  assert.deepEqual(waits, [1000, 2000]);
});

test("4xx other than 429 is not retried", async () => {
  const calls = script(reply(400, { body: "bad filter" }));
  await assert.rejects(legistarFetch(URL_, { sleep }), (e) => e.status === 400 && e.body === "bad filter");
  assert.equal(calls.length, 1);
});

test("a Retry-After longer than the cap is not shortened: the request fails instead", async () => {
  const calls = script(reply(429, { headers: { "Retry-After": String(LEGISTAR_MAX_WAIT_MS / 1000 + 1) } }));
  await assert.rejects(legistarFetch(URL_, { sleep }), (e) => e.status === 429);
  assert.equal(calls.length, 1);
});

test("retryWaitMs reads delay-seconds and HTTP-dates", () => {
  assert.equal(retryWaitMs("2", 1), 2000);
  assert.equal(retryWaitMs(null, 1), 1000);
  assert.equal(retryWaitMs(null, 2), 2000);
  const now = Date.parse("2026-11-18T12:00:00Z");
  assert.equal(retryWaitMs("Wed, 18 Nov 2026 12:00:05 GMT", 1, now), 5000);
  assert.equal(retryWaitMs("Wed, 18 Nov 2026 13:00:00 GMT", 1, now), null);
});

test("the monthly refresh script sends a User-Agent and a timeout too", () => {
  const src = readFileSync(new URL("../scripts/refresh-member-terms.mjs", import.meta.url), "utf8");
  assert.match(src, /"User-Agent": USER_AGENT/);
  assert.match(src, /AbortSignal\.timeout\(TIMEOUT_MS\)/);
});
