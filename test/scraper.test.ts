import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../src/server.ts";
import type { FastifyInstance } from "fastify";
import * as service from "../src/scraper/service.ts";
import { removeDb, useTempDb } from "./support.ts";

process.env["LOG_LEVEL"] = "silent";
const DB_FILE = useTempDb("scraper");

const FIXTURE = [
  "ZA\u00f7Serie A\u00acZY\u00f7Italia\u00acZEE\u00f7serie-a\u00acZC\u00f71\u00acZL\u00f7/calcio/serie-a/",
  "AA\u00f7m1\u00acAB\u00f72\u00acAC\u00f712\u00acAD\u00f71700000000\u00acAE\u00f7Inter\u00acAF\u00f7Milan\u00acAG\u00f71\u00acAH\u00f70\u00acAI\u00f7y\u00acAO\u00f71700000000",
].join("~");

let app: FastifyInstance;
let calls = 0;
const originalFetch = globalThis.fetch;

const makeResponse = (body: string): Response => {
  return {
    ok: true,
    status: 200,
    text: async () => body,
  } as unknown as Response;
}

const fixtureFetch = (async () => {
  calls += 1;
  return makeResponse(FIXTURE);
}) as unknown as typeof fetch;

before(async () => {
  globalThis.fetch = fixtureFetch;
  app = await buildServer();
});

after(async () => {
  globalThis.fetch = originalFetch;
  await app.close();
  removeDb(DB_FILE);
});

beforeEach(() => {
  calls = 0;
  service.clearCache();
});

test("GET /sports returns only the calcio mapping", async () => {
  const response = await app.inject({ method: "GET", url: "/sports" });
  assert.equal(response.statusCode, 200);
  const sports = response.json().sports;
  assert.deepEqual(sports, { 1: "calcio" });
});

test("GET /health reports ok with the configured database", async () => {
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.db, DB_FILE);
});

test("GET /matches parses the feed and caches subsequent calls", async () => {
  const first = await app.inject({ method: "GET", url: "/matches?sport=1&scope=today" });
  assert.equal(first.statusCode, 200);
  const firstBody = first.json();
  assert.equal(firstBody.count, 1);
  assert.equal(firstBody.cached, false);
  assert.equal(firstBody.matches[0].home, "Inter");
  assert.equal(firstBody.matches[0].away, "Milan");
  assert.equal(firstBody.matches[0].home_score, 1);
  assert.equal(firstBody.matches[0].is_live, true);
  assert.equal(calls, 1);

  const second = await app.inject({ method: "GET", url: "/matches?sport=1&scope=today" });
  assert.equal(second.json().cached, true);
  assert.equal(calls, 1);
});

test("POST /cache/clear invalidates the cache", async () => {
  await app.inject({ method: "GET", url: "/matches?sport=1&scope=today" });
  const cleared = await app.inject({ method: "POST", url: "/cache/clear" });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.json().status, "cleared");
  await app.inject({ method: "GET", url: "/matches?sport=1&scope=today" });
  assert.equal(calls, 2);
});

test("GET /matches rejects invalid enrich with 422", async () => {
  const response = await app.inject({ method: "GET", url: "/matches?enrich=bogus" });
  assert.equal(response.statusCode, 422);
});

test("GET /matches rejects invalid scope with 422", async () => {
  const response = await app.inject({ method: "GET", url: "/matches?scope=whatever" });
  assert.equal(response.statusCode, 422);
});

test("GET /db/matches returns matches persisted by a collection", async () => {
  await app.inject({ method: "GET", url: "/matches?sport=1&scope=today&refresh=true" });
  const response = await app.inject({ method: "GET", url: "/db/matches?scope=today" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(body.count >= 1);
  assert.equal(body.matches[0].id, "m1");
});

test("GET /matches/:id/snapshots returns captured state changes", async () => {
  await app.inject({ method: "GET", url: "/matches?sport=1&scope=today&refresh=true" });
  const response = await app.inject({ method: "GET", url: "/matches/m1/snapshots" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(body.length >= 1);
  assert.equal(body[0].match_id, "m1");
});

test("GET /test/scrape reports a successful scrape and always hits the feed", async () => {
  const first = await app.inject({ method: "GET", url: "/test/scrape?scope=today" });
  assert.equal(first.statusCode, 200);
  const body = first.json();
  assert.equal(body.ok, true);
  assert.equal(body.sport, 1);
  assert.equal(body.scope, "today");
  assert.equal(body.feed, "f_1_0_3_it_1");
  assert.equal(body.matches_parsed, 1);
  assert.equal(body.live_matches, 1);
  assert.equal(body.stored, 1);
  assert.equal(body.sample.length, 1);
  assert.equal(body.sample[0].home, "Inter");
  assert.equal(body.sample[0].away, "Milan");
  assert.equal(body.error, null);
  assert.ok(typeof body.elapsed_ms === "number");
  assert.equal(calls, 1);

  const second = await app.inject({ method: "GET", url: "/test/scrape?scope=today" });
  assert.equal(second.statusCode, 200);
  assert.equal(calls, 2);
});

test("GET /test/scrape reports feed failures without throwing", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("network down");
  }) as unknown as typeof fetch;
  try {
    const response = await app.inject({ method: "GET", url: "/test/scrape" });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.ok, false);
    assert.equal(body.matches_parsed, 0);
    assert.equal(body.stored, 0);
    assert.equal(body.sample.length, 0);
    assert.match(body.error, /network down/);
    assert.ok(typeof body.elapsed_ms === "number");
  } finally {
    globalThis.fetch = fixtureFetch;
  }
});

test("GET /test/scrape rejects an unsupported sport with 422", async () => {
  const response = await app.inject({ method: "GET", url: "/test/scrape?sport=99" });
  assert.equal(response.statusCode, 422);
});

test("routes reject non-calcio sports with 422", async () => {
  const urls = [
    "/matches?sport=2",
    "/matches/m1?sport=2",
    "/db/matches?sport=2",
    "/test/scrape?sport=2",
  ];
  for (const url of urls) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 422, url);
  }
});

test("GET /test/scrape rejects an invalid scope with 422", async () => {
  const response = await app.inject({ method: "GET", url: "/test/scrape?scope=whatever" });
  assert.equal(response.statusCode, 422);
});
