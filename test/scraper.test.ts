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

function makeResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => body,
  } as unknown as Response;
}

before(async () => {
  globalThis.fetch = (async () => {
    calls += 1;
    return makeResponse(FIXTURE);
  }) as unknown as typeof fetch;
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

test("GET /sports returns the sport mapping", async () => {
  const response = await app.inject({ method: "GET", url: "/sports" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().sports["1"], "calcio");
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
