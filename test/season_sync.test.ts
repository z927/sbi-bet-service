import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.ts";
import { resetMappingStore, getLeagueLink } from "../src/mapping/repo.ts";

process.env["LOG_LEVEL"] = "silent";
process.env["SUPABASE_URL"] = "";
process.env["SUPABASE_SERVICE_ROLE_KEY"] = "";
process.env["API_FOOTBALL_KEY"] = "test-key";

const originalFetch = globalThis.fetch;

const envelope = (response: unknown[], total = 1): string =>
  JSON.stringify({ errors: [], results: response.length, paging: { current: 1, total }, response });

const LEAGUE = {
  league: { id: 135, name: "Serie A", type: "League" },
  country: { name: "Italy" },
  seasons: [
    { year: 2025, start: "2025-08-01", end: "2026-05-31", current: false },
    { year: 2026, start: "2026-08-01", end: "2027-05-31", current: true },
  ],
};

const TEAMS = [
  { team: { id: 489, name: "Inter" } },
  { team: { id: 490, name: "Milan" } },
];

const FIXTURES_PAGE_1 = [
  {
    fixture: { id: 1, date: "2026-08-23T18:45:00+02:00" },
    league: { id: 135, season: 2026 },
    teams: { home: { id: 489, name: "Inter" }, away: { id: 490, name: "Milan" } },
    goals: { home: null, away: null },
  },
];

const FIXTURES_PAGE_2 = [
  {
    fixture: { id: 2, date: "2026-09-01T20:45:00+02:00" },
    league: { id: 135, season: 2026 },
    teams: { home: { id: 490, name: "Milan" }, away: { id: 489, name: "Inter" } },
    goals: { home: null, away: null },
  },
];

const mockFetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  let body: string;
  if (url.pathname.endsWith("/leagues")) {
    body = envelope([LEAGUE]);
  } else if (url.pathname.endsWith("/teams")) {
    body = envelope(TEAMS);
  } else if (url.pathname.endsWith("/fixtures")) {
    const page = url.searchParams.get("page");
    body = page === "2" ? envelope(FIXTURES_PAGE_2, 2) : envelope(FIXTURES_PAGE_1, 2);
  } else {
    throw new Error(`unexpected URL: ${url.toString()}`);
  }
  return { ok: true, status: 200, text: async () => body } as unknown as Response;
}) as unknown as typeof fetch;

let app: FastifyInstance;

before(async () => {
  globalThis.fetch = mockFetch;
  app = await buildServer();
});

after(async () => {
  globalThis.fetch = originalFetch;
  await app.close();
});

beforeEach(() => {
  resetMappingStore();
  process.env["API_FOOTBALL_KEY"] = "test-key";
});

const sync = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/mapping/seasons/sync", payload });

const listTeams = async (): Promise<Array<{ id: string; name: string }>> => {
  const response = await app.inject({ method: "GET", url: "/mapping/teams" });
  return response.json();
};

test("sync uses the current season, imports teams and links every fixture", async () => {
  const response = await sync({ leagueId: 135, direttaTournamentId: "COuk57Ci" });
  assert.equal(response.statusCode, 200);
  const report = response.json();

  assert.equal(report.league.season, 2026);
  assert.equal(report.league.current, true);
  assert.equal(report.league.name, "Serie A");
  assert.equal(report.teams.seen, 2);
  assert.equal(report.teams.created, 2);
  assert.equal(report.teams.mapped, 2);
  assert.equal(report.fixtures.seen, 2);
  assert.equal(report.fixtures.created, 2);
  assert.deepEqual(report.errors, []);

  const link = await getLeagueLink(135);
  assert.equal(link?.direttaTournamentId, "COuk57Ci");

  const teams = await listTeams();
  assert.equal(teams.length, 2);
  const inter = teams.find((team) => team.name === "Inter");
  const milan = teams.find((team) => team.name === "Milan");
  assert.ok(inter);
  assert.ok(milan);

  const fixture = await app.inject({
    method: "GET",
    url: `/mapping/fixtures/resolve?date=2026-08-23&homeTeamId=${inter.id}&awayTeamId=${milan.id}`,
  });
  assert.equal(fixture.statusCode, 200);
  assert.equal(fixture.json().apiFootballFixtureId, "1");
  assert.equal(fixture.json().direttaMatchId, null);
});

test("sync is idempotent: a second run only updates existing links", async () => {
  await sync({ leagueId: 135 });
  const second = await sync({ leagueId: 135 });
  assert.equal(second.statusCode, 200);
  const report = second.json();
  assert.equal(report.teams.created, 0);
  assert.equal(report.teams.mapped, 2);
  assert.equal(report.fixtures.created, 0);
  assert.equal(report.fixtures.updated, 2);
  assert.equal((await listTeams()).length, 2);
});

test("dryRun reports the work without persisting anything", async () => {
  const response = await sync({ leagueId: 135, dryRun: true });
  assert.equal(response.statusCode, 200);
  const report = response.json();
  assert.equal(report.dryRun, true);
  assert.equal(report.teams.created, 2);
  assert.equal(report.fixtures.created, 2);

  assert.equal((await listTeams()).length, 0);
  assert.equal(await getLeagueLink(135), null);
});

test("an explicit non-current season is reported as such", async () => {
  const response = await sync({ leagueId: 135, season: 2025 });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().league.season, 2025);
  assert.equal(response.json().league.current, false);
});

test("a missing API-Football key is reported as 502", async () => {
  process.env["API_FOOTBALL_KEY"] = "";
  const response = await sync({ leagueId: 135 });
  assert.equal(response.statusCode, 502);
  assert.match(response.json().detail, /API_FOOTBALL_KEY/);
});

test("invalid leagueId is rejected with 422", async () => {
  const response = await sync({ leagueId: 0 });
  assert.equal(response.statusCode, 422);
});
