import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../src/server.ts";
import type { FastifyInstance } from "fastify";
import * as schedule from "../src/services/schedule_service.ts";
import * as monitoring from "../src/services/monitoring_service.ts";
import * as matches from "../src/services/matches_service.ts";
import { removeDb, useTempDb } from "./support.ts";

process.env["LOG_LEVEL"] = "silent";
const DB_FILE = useTempDb("sbi");

const originalFetch = globalThis.fetch;
const FIXTURE = [
  "ZA\u00f7ITALIA: Serie A\u00acZY\u00f7Italia\u00acZEE\u00f7COuk57Ci\u00acZC\u00f71\u00acZL\u00f7/calcio/italia/serie-a/",
  "AA\u00f7m1\u00acAB\u00f72\u00acAC\u00f712\u00acAD\u00f71700000000\u00acAE\u00f7Inter\u00acAF\u00f7Milan\u00acAG\u00f71\u00acAH\u00f70\u00acAI\u00f7y\u00acAO\u00f71700000000",
].join("~");
const STATS_FIXTURE = ["SE\u00f7Partita", "SF\u00f7Tiri", "SD\u00f713\u00acSG\u00f7Tiri in porta\u00acSH\u00f74\u00acSI\u00f72"].join("~");

const makeResponse = (body: string): Response => {
  return { ok: true, status: 200, text: async () => body } as unknown as Response;
}

const fixtureFetch = (async (url: string) =>
  makeResponse(String(url).includes("df_st_") ? STATS_FIXTURE : FIXTURE)) as unknown as typeof fetch;

let app: FastifyInstance;

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
  schedule.reset();
  monitoring.reset();
  matches.reset();
});

test("POST /api/v1/schedule returns 200 BaseResponse", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/schedule",
    payload: { defaultFixtures: [{ fixtureId: 1, match: "A-B" }] },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(typeof body.message, "string");
  assert.equal(body.statusCode, 200);
});

test("POST /api/v1/schedule returns 409 on duplicate day", async () => {
  const payload = { defaultFixtures: [{ fixtureId: 1, match: "A-B" }] };
  const first = await app.inject({ method: "POST", url: "/api/v1/schedule?day=2026-01-01", payload });
  assert.equal(first.statusCode, 200);
  const second = await app.inject({ method: "POST", url: "/api/v1/schedule?day=2026-01-01", payload });
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().statusCode, 409);
});

test("POST /api/v1/schedule rejects invalid day with 422", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/schedule?day=not-a-date",
    payload: {},
  });
  assert.equal(response.statusCode, 422);
});

test("POST /api/v1/schedule rejects invalid body with 422", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/schedule",
    payload: { defaultFixtures: "nope" },
  });
  assert.equal(response.statusCode, 422);
});

test("GET /api/v1/auto-schedule returns BaseResponse (scheduler unconfigured: 200 twice)", async () => {
  const first = await app.inject({ method: "GET", url: "/api/v1/auto-schedule" });
  assert.equal(first.statusCode, 200);
  assert.equal(typeof first.json().message, "string");
  assert.equal(first.json().statusCode, 200);
  const second = await app.inject({ method: "GET", url: "/api/v1/auto-schedule" });
  assert.equal(second.statusCode, 200);
});

test("GET /api/v1/monitor runs the live strategy and returns BaseResponse", async () => {
  const response = await app.inject({ method: "GET", url: "/api/v1/monitor" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(typeof body.message, "string");
  assert.equal(body.statusCode, 200);

  const monitored = await app.inject({ method: "GET", url: "/api/v1/monitored" });
  assert.equal(monitored.statusCode, 200);
  assert.deepEqual(monitored.json(), []);
});

test("POST /api/v1/monitor is not part of the contract", async () => {
  const response = await app.inject({ method: "POST", url: "/api/v1/monitor", payload: [] });
  assert.equal(response.statusCode, 404);
});

test("GET /api/v1/scheduled-fixtures returns BaseResponse", async () => {
  const response = await app.inject({ method: "GET", url: "/api/v1/scheduled-fixtures" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().statusCode, 200);
});

test("GET /api/v1/matches returns MatchModel array respecting date filter", async () => {
  matches.setMatches([
    { id: 1, league: "Serie A", match: "Inter-Milan", startTime: "2026-01-01T12:00:00" },
    { id: 2, league: "Serie A", match: "Roma-Lazio", startTime: "2026-02-01T18:00:00" },
  ]);
  const all = await app.inject({ method: "GET", url: "/api/v1/matches" });
  assert.equal(all.statusCode, 200);
  assert.equal(all.json().length, 2);

  const filtered = await app.inject({ method: "GET", url: "/api/v1/matches?date=2026-01-01" });
  assert.equal(filtered.statusCode, 200);
  assert.equal(filtered.json().length, 1);
});

test("GET /api/v1/matches preserves wire field names", async () => {
  matches.setMatches([
    {
      id: 1,
      league: "Serie A",
      match: "Inter-Milan",
      score: "1-0",
      firstHalfScore: "1-0",
      startTime: "2026-01-01T12:00:00",
      slug: "inter-milan",
      favouriteTeam: "Inter",
      monitored: true,
      favouriteStrategyUsed: false,
    },
  ]);
  const response = await app.inject({ method: "GET", url: "/api/v1/matches" });
  const [match] = response.json();
  assert.equal(match.firstHalfScore, "1-0");
  assert.equal(match.startTime, "2026-01-01T12:00:00");
  assert.equal(match.favouriteTeam, "Inter");
  assert.equal(match.favouriteStrategyUsed, false);
});
