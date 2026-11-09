import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../src/server.ts";
import * as signals from "../src/services/signals_service.ts";
import type { SignalItem, SignalsResponse, SignalRecap, SignalListRow } from "../src/services/signals_service.ts";
import type { FastifyInstance } from "fastify";

process.env["LOG_LEVEL"] = "silent";

const makeSignal = (overrides: Partial<SignalItem> = {}): SignalItem => ({
  id: "s1",
  matchId: "m1",
  rule: "goal_over_ht",
  home: "Inter",
  away: "Milan",
  minute: 15,
  value: 1.67,
  result: "win",
  quota: null,
  win: null,
  type: "signal",
  ...overrides,
});

let app: FastifyInstance;

before(async () => {
  app = await buildServer();
});

after(async () => {
  await app.close();
});

beforeEach(() => {
  signals.reset();
});

test("GET /api/v1/signals returns 200 with empty recap and signals", async () => {
  const response = await app.inject({ method: "GET", url: "/api/v1/signals" });
  assert.equal(response.statusCode, 200);
  const body = response.json() as SignalsResponse;
  assert.ok(body.recap);
  assert.ok(Array.isArray(body.signals));
  assert.equal(body.recap.totalCount, 0);
  assert.equal(body.recap.winCount, 0);
  assert.equal(body.recap.loseCount, 0);
  assert.equal(body.recap.percentageWin, "");
  assert.equal(body.recap.percentageLose, "");
  assert.equal(body.recap.averageOdd, 0);
  assert.equal(body.signals.length, 0);
});

test("GET /api/v1/signals returns list with required fields including matchDate", async () => {
  signals.setSignals([
    makeSignal({ id: "s1", home: "Inter", away: "Milan", matchId: "m1", win: true }),
    makeSignal({ id: "s2", home: "Juventus", away: "Roma", matchId: "m2", win: false }),
  ]);

  const response = await app.inject({ method: "GET", url: "/api/v1/signals" });
  assert.equal(response.statusCode, 200);
  const body = response.json() as SignalsResponse;
  assert.ok(body.recap);
  assert.ok(Array.isArray(body.signals));
  assert.equal(body.signals.length, 2);
  assert.equal(body.recap.totalCount, 2);
  assert.equal(body.recap.winCount, 1);
  assert.equal(body.recap.loseCount, 1);
  assert.equal(body.recap.percentageWin, "50%");
  assert.equal(body.recap.percentageLose, "50%");

  const row = body.signals[0] as SignalListRow;
  assert.equal(row.home, "Inter");
  assert.equal(row.away, "Milan");
  assert.equal(row.matchId, "m1");
  assert.equal(row.tournament, "");
  assert.equal(row.homeScore, null);
  assert.equal(row.awayScore, null);
  assert.equal(row.matchDate, null);
  assert.equal(row.win, true);

  const row2 = body.signals[1] as SignalListRow;
  assert.equal(row2.home, "Juventus");
  assert.equal(row2.away, "Roma");
  assert.equal(row2.matchId, "m2");
  assert.equal(row2.win, false);
});

test("GET /api/v1/signals exposes all wire fields", async () => {
  signals.setSignals([makeSignal()]);
  const response = await app.inject({ method: "GET", url: "/api/v1/signals" });
  assert.equal(response.statusCode, 200);
  const body = response.json() as SignalsResponse;
  assert.ok(Array.isArray(body.signals));
  assert.equal(body.signals.length, 1);
  const row = body.signals[0] as SignalListRow;
  assert.ok("home" in row);
  assert.ok("away" in row);
  assert.ok("matchId" in row);
  assert.ok("tournament" in row);
  assert.ok("homeScore" in row);
  assert.ok("awayScore" in row);
  assert.ok("matchDate" in row);
  assert.ok("win" in row);
  assert.ok("recap" in body);
});

test("GET /api/v1/signals reset clears the list", async () => {
  signals.setSignals([makeSignal()]);
  let response = await app.inject({ method: "GET", url: "/api/v1/signals" });
  assert.equal((response.json() as SignalsResponse).signals.length, 1);

  signals.reset();
  response = await app.inject({ method: "GET", url: "/api/v1/signals" });
  assert.equal((response.json() as SignalsResponse).signals.length, 0);
  const body = response.json() as SignalsResponse;
  assert.equal(body.recap.totalCount, 0);
});

test("GET /api/v1/signals/settle returns 200 with zero settled when no unresolved signals", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/signals/settle",
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(typeof body.settled, "number");
  assert.equal(typeof body.skipped, "number");
  assert.equal(typeof body.message, "string");
});

test("GET /api/v1/signals/settle returns 422 on invalid date", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/signals/settle?date=not-a-date",
  });
  assert.equal(response.statusCode, 422);
});

test("GET /api/v1/signals/settle accepts optional date", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/signals/settle?date=2026-11-09",
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(typeof body.settled, "number");
  assert.equal(typeof body.skipped, "number");
});
