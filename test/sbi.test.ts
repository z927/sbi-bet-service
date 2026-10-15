import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../src/server.ts";
import type { FastifyInstance } from "fastify";
import * as schedule from "../src/sbi/services/schedule_service.ts";
import * as monitoring from "../src/sbi/services/monitoring_service.ts";
import * as matches from "../src/sbi/services/matches_service.ts";
import { removeDb, useTempDb } from "./support.ts";

process.env["LOG_LEVEL"] = "silent";
const DB_FILE = useTempDb("sbi");

let app: FastifyInstance;

before(async () => {
  app = await buildServer();
});

after(async () => {
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

test("GET /api/v1/auto-schedule returns 200 then 409", async () => {
  const first = await app.inject({ method: "GET", url: "/api/v1/auto-schedule" });
  assert.equal(first.statusCode, 200);
  const second = await app.inject({ method: "GET", url: "/api/v1/auto-schedule" });
  assert.equal(second.statusCode, 409);
});

test("POST /api/v1/monitor stores fixtures and GET /monitored returns them", async () => {
  const fixtures = [
    {
      fixtureId: 10,
      league: { name: "Serie A", country: "Italia", leagueId: 1 },
      home: { team: "Inter", teamId: 1, score: 1, favourite: true },
      away: { team: "Milan", teamId: 2, score: 0, favourite: false },
      info: { statusDescription: "LIVE", monitored: true, elapsed: 30, favouriteStrategyUsed: false },
      time: { startTime: "2026-01-01T12:00:00", beginMonitoringTime: "", endMonitoringTime: "" },
      period: "1H",
    },
  ];
  const response = await app.inject({ method: "POST", url: "/api/v1/monitor", payload: fixtures });
  assert.equal(response.statusCode, 200);

  const monitored = await app.inject({ method: "GET", url: "/api/v1/monitored" });
  assert.equal(monitored.statusCode, 200);
  const body = monitored.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].fixtureId, 10);
  assert.equal(body[0].league.name, "Serie A");
});

test("POST /api/v1/monitor rejects non-array body with 422", async () => {
  const response = await app.inject({ method: "POST", url: "/api/v1/monitor", payload: { fixtureId: 1 } });
  assert.equal(response.statusCode, 422);
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
