import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as teamsRepo from "../src/services/teams_repo.ts";
import type { TeamInput } from "../src/services/teams_repo.ts";

process.env["LOG_LEVEL"] = "silent";
process.env["SUPABASE_URL"] = "";
process.env["SUPABASE_SERVICE_ROLE_KEY"] = "";

const SAMPLE_TEAMS: TeamInput[] = [
  {
    diretta_name: "Arsenal",
    api_football_id: 42,
    api_football_name: "Arsenal",
    api_football_league_id: 39,
    api_football_league_name: "Premier League",
    country: "England",
  },
  {
    diretta_name: "Chelsea",
    api_football_id: 49,
    api_football_name: "Chelsea",
    api_football_league_id: 39,
    api_football_league_name: "Premier League",
    country: "England",
  },
  {
    diretta_name: "Lazio",
    api_football_id: 487,
    api_football_name: "Lazio",
    api_football_league_id: 135,
    api_football_league_name: "Serie A",
    country: "Italy",
  },
  {
    diretta_name: "NoMapping",
    api_football_id: null,
    api_football_name: null,
    api_football_league_id: null,
    api_football_league_name: null,
    country: null,
  },
];

beforeEach(() => {
  teamsRepo.initTeamsRepo();
});

test("upsertTeams stores teams in memory", async () => {
  const count = await teamsRepo.upsertTeams(SAMPLE_TEAMS);
  assert.equal(count, 4);

  const all = await teamsRepo.getTeams();
  assert.equal(all.length, 4);
});

test("getTeam retrieves a single team by diretta name", async () => {
  await teamsRepo.upsertTeams(SAMPLE_TEAMS);

  const team = await teamsRepo.getTeam("Arsenal");
  assert.ok(team);
  assert.equal(team!.diretta_name, "Arsenal");
  assert.equal(team!.api_football_id, 42);
  assert.equal(team!.api_football_league_id, 39);
  assert.equal(team!.country, "England");
});

test("getTeam returns null for unknown team", async () => {
  await teamsRepo.upsertTeams(SAMPLE_TEAMS);

  const team = await teamsRepo.getTeam("Unknown");
  assert.equal(team, null);
});

test("getTeamsByApiFootballLeague filters by api_football_league_id", async () => {
  await teamsRepo.upsertTeams(SAMPLE_TEAMS);

  const plTeams = await teamsRepo.getTeamsByApiFootballLeague(39);
  assert.equal(plTeams.length, 2);
  assert.ok(plTeams.every((t) => t.api_football_league_id === 39));

  const serieATeams = await teamsRepo.getTeamsByApiFootballLeague(135);
  assert.equal(serieATeams.length, 1);
  const lazio = serieATeams[0];
  assert.ok(lazio);
  assert.equal(lazio.diretta_name, "Lazio");
});

test("countTeams returns correct count", async () => {
  await teamsRepo.upsertTeams(SAMPLE_TEAMS);

  const count = await teamsRepo.countTeams();
  assert.equal(count, 4);
});

test("deleteAllTeams clears all teams", async () => {
  await teamsRepo.upsertTeams(SAMPLE_TEAMS);

  await teamsRepo.deleteAllTeams();

  const count = await teamsRepo.countTeams();
  assert.equal(count, 0);

  const all = await teamsRepo.getTeams();
  assert.equal(all.length, 0);
});

test("upsertTeams updates existing team", async () => {
  const arsenal = SAMPLE_TEAMS[0]!;
  await teamsRepo.upsertTeams([arsenal]);

  const updated = await teamsRepo.upsertTeams([
    {
      ...arsenal,
      api_football_id: 999,
      api_football_name: "Arsenal FC",
    } satisfies TeamInput,
  ]);
  assert.equal(updated, 1);

  const team = await teamsRepo.getTeam("Arsenal");
  assert.ok(team);
  assert.equal(team.api_football_id, 999);
  assert.equal(team.api_football_name, "Arsenal FC");
});