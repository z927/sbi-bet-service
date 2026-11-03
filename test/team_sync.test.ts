import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.ts";
import { getLeagueLink, listMappings, resetMappingStore } from "../src/mapping/repo.ts";

process.env["LOG_LEVEL"] = "silent";
process.env["SUPABASE_URL"] = "";
process.env["SUPABASE_SERVICE_ROLE_KEY"] = "";
process.env["API_FOOTBALL_KEY"] = "test-key";

const originalFetch = globalThis.fetch;

const envelope = (response: unknown[]): string =>
  JSON.stringify({ errors: [], results: response.length, paging: { current: 1, total: 1 }, response });

const LEAGUE = {
  league: { id: 135, name: "Serie A", type: "League" },
  country: { name: "Italy" },
  seasons: [{ year: 2026, start: "2026-08-01", end: "2027-05-31", current: true }],
};

const TEAMS = [
  { team: { id: 489, name: "Inter" } },
  { team: { id: 490, name: "Milan" } },
];

const asResponse = (body: string, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, text: async () => body }) as unknown as Response;

const direttaFeed = (home: string, away: string): string =>
  [
    "ZA÷Serie A¬ZY÷Italia¬ZEE÷COuk57Ci",
    "AA÷dir-1¬AE÷" + home + "¬AF÷" + away + "¬PX÷D1¬PY÷D2¬AB÷1¬AC÷1",
    "ZA÷Altro¬ZY÷Italia¬ZEE÷OTHER",
    "AA÷dir-9¬AE÷Juventus¬AF÷Roma¬PX÷D9¬PY÷D8¬AB÷1¬AC÷1",
  ].join("~");

let feed = direttaFeed("Inter", "Milan");

const mockFetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.hostname.endsWith("api-sports.io")) {
    if (url.pathname.endsWith("/leagues")) return asResponse(envelope([LEAGUE]));
    if (url.pathname.endsWith("/teams")) return asResponse(envelope(TEAMS));
    throw new Error(`unexpected API-Football URL: ${url.toString()}`);
  }
  if (url.hostname === "www.diretta.it") {
    return asResponse(feed);
  }
  throw new Error(`unexpected URL: ${url.toString()}`);
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
  feed = direttaFeed("Inter", "Milan");
});

const sync = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/mapping/teams/sync", payload });

const listTeams = async (): Promise<Array<{ id: string; name: string }>> => {
  const response = await app.inject({ method: "GET", url: "/mapping/teams" });
  return response.json();
};

test("sync imports API-Football teams and matches diretta teams by alias", async () => {
  const response = await sync({ leagueId: 135, direttaTournamentId: "COuk57Ci" });
  assert.equal(response.statusCode, 200);
  const report = response.json();

  assert.equal(report.league.name, "Serie A");
  assert.equal(report.league.season, 2026);
  assert.equal(report.direttaTournamentId, "COuk57Ci");
  assert.deepEqual(report.apiFootball, {
    seen: 2,
    created: 2,
    mapped: 0,
    pending: 0,
    unmatched: 0,
  });
  assert.deepEqual(report.diretta, {
    seen: 2,
    created: 0,
    mapped: 2,
    pending: 0,
    unmatched: 0,
  });
  assert.deepEqual(report.errors, []);

  const teams = await listTeams();
  assert.deepEqual(
    teams.map((team) => team.name).sort(),
    ["Inter", "Milan"],
  );
  assert.equal((await getLeagueLink(135))?.direttaTournamentId, "COuk57Ci");

  const mappings = await listMappings("confirmed");
  const direttaMappings = mappings.filter((mapping) => mapping.provider === "diretta");
  assert.equal(direttaMappings.length, 2);
  const inter = teams.find((team) => team.name === "Inter");
  assert.ok(inter);
  const interMapping = direttaMappings.find((mapping) => mapping.providerTeamId === "D1");
  assert.equal(interMapping?.teamId, inter.id);
});

test("sync is idempotent and does not create duplicate teams", async () => {
  await sync({ leagueId: 135, direttaTournamentId: "COuk57Ci" });
  const second = await sync({ leagueId: 135 });
  assert.equal(second.statusCode, 200);
  const report = second.json();
  assert.equal(report.apiFootball.created, 0);
  assert.equal(report.apiFootball.mapped, 2);
  assert.equal(report.diretta.created, 0);
  assert.equal(report.diretta.mapped, 2);
  assert.equal((await listTeams()).length, 2);
});

test("fuzzy diretta teams stay pending for manual review", async () => {
  feed = direttaFeed("Internazionale", "Milan");
  const response = await sync({ leagueId: 135, direttaTournamentId: "COuk57Ci" });
  assert.equal(response.statusCode, 200);
  const report = response.json();
  assert.equal(report.diretta.pending, 1);
  assert.equal(report.diretta.mapped, 1);
  assert.equal((await listTeams()).length, 2);

  const pending = await listMappings("pending");
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.provider, "diretta");
  assert.equal(pending[0]?.providerTeamId, "D1");
  assert.equal(pending[0]?.source, "fuzzy");
});

test("dryRun reports the work without persisting anything", async () => {
  const response = await sync({ leagueId: 135, direttaTournamentId: "COuk57Ci", dryRun: true });
  assert.equal(response.statusCode, 200);
  const report = response.json();
  assert.equal(report.dryRun, true);
  assert.equal(report.apiFootball.created, 2);
  assert.equal(report.diretta.created, 2);
  assert.equal((await listTeams()).length, 0);
  assert.equal(await getLeagueLink(135), null);
});

test("direttaTournamentId can be reused from the stored league link", async () => {
  await sync({ leagueId: 135, direttaTournamentId: "COuk57Ci" });
  const response = await sync({ leagueId: 135 });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().direttaTournamentId, "COuk57Ci");
});

test("missing direttaTournamentId is rejected with 422", async () => {
  const response = await sync({ leagueId: 135 });
  assert.equal(response.statusCode, 422);
  assert.match(response.json().detail, /direttaTournamentId/);
});

test("invalid leagueId is rejected with 422", async () => {
  const response = await sync({ leagueId: 0, direttaTournamentId: "COuk57Ci" });
  assert.equal(response.statusCode, 422);
});
