import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.ts";
import { normalizeTeamName, similarity } from "../src/mapping/normalize.ts";
import { resetMappingStore } from "../src/mapping/repo.ts";

process.env["LOG_LEVEL"] = "silent";
process.env["SUPABASE_URL"] = "";
process.env["SUPABASE_SERVICE_ROLE_KEY"] = "";

let app: FastifyInstance;

before(async () => {
  app = await buildServer();
});

after(async () => {
  await app.close();
});

beforeEach(() => {
  resetMappingStore();
});

const createTeam = async (name: string, country?: string): Promise<string> => {
  const response = await app.inject({
    method: "POST",
    url: "/mapping/teams",
    payload: { name, country },
  });
  assert.equal(response.statusCode, 201);
  return response.json().id;
};

test("normalizeTeamName strips accents, punctuation and club stopwords", () => {
  assert.equal(normalizeTeamName("AC Milan"), "milan");
  assert.equal(normalizeTeamName("Paris Saint-Germain"), "paris saint germain");
  assert.equal(normalizeTeamName("Bayern München"), "bayern munchen");
});

test("similarity boosts containment so short aliases match long names", () => {
  assert.equal(similarity("Inter", "Inter"), 1);
  assert.ok(similarity("Inter", "Internazionale") >= 0.85);
  assert.ok(similarity("Inter", "Milan") < 0.5);
});

test("resolve matches an exact alias and stores a confirmed mapping", async () => {
  await createTeam("Inter", "Italia");

  const first = await app.inject({
    method: "GET",
    url: "/mapping/teams/resolve?provider=diretta&providerTeamId=ABC123&name=Inter",
  });
  assert.equal(first.statusCode, 200);
  const body = first.json();
  assert.equal(body.status, "matched");
  assert.equal(body.team.name, "Inter");
  assert.equal(body.mapping.status, "confirmed");
  assert.equal(body.mapping.source, "alias");

  const second = await app.inject({
    method: "GET",
    url: "/mapping/teams/resolve?provider=diretta&providerTeamId=ABC123&name=Something%20Else",
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().status, "matched");
  assert.equal(second.json().team.name, "Inter");
});

test("resolve stores fuzzy matches as pending for manual review", async () => {
  await createTeam("Inter", "Italia");

  const response = await app.inject({
    method: "GET",
    url: "/mapping/teams/resolve?provider=api_football&providerTeamId=489&name=Internazionale",
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.status, "pending");
  assert.equal(body.team.name, "Inter");
  assert.equal(body.mapping.status, "pending");
  assert.equal(body.mapping.source, "fuzzy");
  assert.ok(body.mapping.confidence >= 0.82);
  assert.equal(body.candidates[0].team.name, "Inter");
});

test("a rejected mapping is reported and not silently rematched", async () => {
  await createTeam("Inter", "Italia");
  const resolved = await app.inject({
    method: "GET",
    url: "/mapping/teams/resolve?provider=diretta&providerTeamId=BAD&name=Inter",
  });
  const mappingId = resolved.json().mapping.id;

  const rejected = await app.inject({
    method: "POST",
    url: `/mapping/mappings/${mappingId}/status`,
    payload: { status: "rejected" },
  });
  assert.equal(rejected.statusCode, 200);
  assert.equal(rejected.json().status, "rejected");

  const again = await app.inject({
    method: "GET",
    url: "/mapping/teams/resolve?provider=diretta&providerTeamId=BAD&name=Inter",
  });
  assert.equal(again.json().status, "rejected");
});

test("fixture links are upserted and resolved by canonical teams and date", async () => {
  const homeId = await createTeam("Inter");
  const awayId = await createTeam("Milan");

  const created = await app.inject({
    method: "PUT",
    url: "/mapping/fixtures",
    payload: {
      matchDate: "2026-10-31",
      homeTeamId: homeId,
      awayTeamId: awayId,
      direttaMatchId: "dir-1",
      apiFootballFixtureId: "af-1",
      kickoffAt: "2026-10-31T18:00:00+01:00",
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().matchDate, "2026-10-31");

  const found = await app.inject({
    method: "GET",
    url: `/mapping/fixtures/resolve?date=2026-10-31&homeTeamId=${homeId}&awayTeamId=${awayId}`,
  });
  assert.equal(found.statusCode, 200);
  assert.equal(found.json().direttaMatchId, "dir-1");
  assert.equal(found.json().apiFootballFixtureId, "af-1");

  const missing = await app.inject({
    method: "GET",
    url: `/mapping/fixtures/resolve?date=2026-11-01&homeTeamId=${homeId}&awayTeamId=${awayId}`,
  });
  assert.equal(missing.statusCode, 404);
});

test("invalid provider and invalid date are rejected with 422", async () => {
  const provider = await app.inject({ method: "GET", url: "/mapping/teams/resolve?provider=sofascore" });
  assert.equal(provider.statusCode, 422);

  const homeId = await createTeam("Inter");
  const awayId = await createTeam("Milan");
  const date = await app.inject({
    method: "PUT",
    url: "/mapping/fixtures",
    payload: {
      matchDate: "31/10/2026",
      homeTeamId: homeId,
      awayTeamId: awayId,
      direttaMatchId: "dir-1",
    },
  });
  assert.equal(date.statusCode, 422);
});
