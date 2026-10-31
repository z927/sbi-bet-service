import { ValidationError } from "../errors.ts";
import { isIsoDate } from "../validation.ts";
import * as af from "../clients/apifootball/client.ts";
import { normalizeTeamName, rankCandidates } from "./normalize.ts";
import * as repo from "./repo.ts";
import {
  MAPPING_SOURCES,
  MAPPING_STATUSES,
  PROVIDERS,
  type CreateTeamInput,
  type FixtureLink,
  type LeagueLink,
  type MappingStatus,
  type Provider,
  type ResolveTeamInput,
  type ResolveTeamResult,
  type SyncSeasonInput,
  type SyncSeasonReport,
  type Team,
  type TeamAlias,
  type TeamProviderMapping,
  type UpsertFixtureLinkInput,
  type UpsertLeagueLinkInput,
  type UpsertMappingInput,
} from "./models.ts";

export const FUZZY_THRESHOLD = 0.82;

const assertProvider = (provider: string): Provider => {
  if (!(PROVIDERS as readonly string[]).includes(provider)) {
    throw new ValidationError(`provider must be one of: ${PROVIDERS.join(", ")}`);
  }
  return provider as Provider;
};

const assertStatus = (status: string): MappingStatus => {
  if (!(MAPPING_STATUSES as readonly string[]).includes(status)) {
    throw new ValidationError(`status must be one of: ${MAPPING_STATUSES.join(", ")}`);
  }
  return status as MappingStatus;
};

const sameCountry = (left: string | null, right: string): boolean =>
  left !== null && normalizeTeamName(left) === normalizeTeamName(right);

const emptyResult = (status: ResolveTeamResult["status"]): ResolveTeamResult => ({
  status,
  team: null,
  mapping: null,
  confidence: 0,
  candidates: [],
});

export const resolveTeam = async (input: ResolveTeamInput): Promise<ResolveTeamResult> => {
  const provider = assertProvider(input.provider);
  const autoLink = input.autoLink ?? true;
  const providerTeamId = input.providerTeamId?.trim() ?? "";

  if (providerTeamId !== "") {
    const existing = await repo.findMapping(provider, providerTeamId);
    if (existing) {
      const team = await repo.getTeam(existing.teamId);
      return {
        status: existing.status === "confirmed" ? "matched" : existing.status,
        team,
        mapping: existing,
        confidence: existing.confidence,
        candidates: [],
      };
    }
  }

  const name = input.name?.trim() ?? "";
  if (name === "") {
    return emptyResult("unmatched");
  }

  const normalized = normalizeTeamName(name);
  if (normalized !== "") {
    const exact = await repo.findTeamsByNormalizedAlias(normalized);
    const filtered = input.country ? exact.filter((team) => sameCountry(team.country, input.country!)) : exact;
    const matches = filtered.length > 0 ? filtered : exact;
    if (matches.length === 1) {
      const team = matches[0]!;
      let mapping: TeamProviderMapping | null = null;
      if (autoLink && providerTeamId !== "") {
        mapping = await repo.upsertMapping({
          teamId: team.id,
          provider,
          providerTeamId,
          rawName: name,
          country: input.country ?? team.country,
          confidence: 1,
          status: "confirmed",
          source: "alias",
        });
        await repo.addAlias(team.id, name, "alias");
      }
      return { status: "matched", team, mapping, confidence: 1, candidates: [] };
    }
    if (matches.length > 1) {
      return {
        status: "pending",
        team: null,
        mapping: null,
        confidence: 1,
        candidates: matches.map((team) => ({ team, confidence: 1 })),
      };
    }
  }

  const teams = await repo.listTeamsWithAliases();
  const sameCountryPool = input.country
    ? teams.filter((entry) => sameCountry(entry.team.country, input.country!))
    : [];
  const pool = sameCountryPool.length > 0 ? sameCountryPool : teams;
  const candidates = rankCandidates(name, pool, FUZZY_THRESHOLD);
  if (candidates.length === 0) {
    return emptyResult("unmatched");
  }

  const best = candidates[0]!;
  if (autoLink && providerTeamId !== "") {
    const mapping = await repo.upsertMapping({
      teamId: best.team.id,
      provider,
      providerTeamId,
      rawName: name,
      country: input.country ?? best.team.country,
      confidence: best.confidence,
      status: "pending",
      source: "fuzzy",
    });
    return { status: "pending", team: best.team, mapping, confidence: best.confidence, candidates };
  }
  return { status: "pending", team: best.team, mapping: null, confidence: best.confidence, candidates };
};

export const createTeam = async (input: CreateTeamInput): Promise<Team> => {
  const name = input.name?.trim() ?? "";
  if (name === "") {
    throw new ValidationError("name is required");
  }
  const team = await repo.createTeam(name, input.country ?? null);
  await repo.addAlias(team.id, name, "manual");
  for (const alias of input.aliases ?? []) {
    const trimmed = alias.trim();
    if (trimmed !== "") {
      await repo.addAlias(team.id, trimmed, "manual");
    }
  }
  return team;
};

export const listTeams = (): Promise<Team[]> => repo.listTeams();

export const listAliases = (teamId: string): Promise<TeamAlias[]> => repo.listAliases(teamId);

export const addAlias = async (teamId: string, alias: string, source = "manual"): Promise<TeamAlias> => {
  const team = await repo.getTeam(teamId);
  if (!team) {
    throw new ValidationError(`unknown team: ${teamId}`);
  }
  const trimmed = alias.trim();
  if (trimmed === "") {
    throw new ValidationError("alias is required");
  }
  return repo.addAlias(teamId, trimmed, source);
};

export const listMappings = (status?: string): Promise<TeamProviderMapping[]> => {
  return repo.listMappings(status === undefined ? undefined : assertStatus(status));
};

export const upsertMapping = async (input: UpsertMappingInput): Promise<TeamProviderMapping> => {
  const team = await repo.getTeam(input.teamId);
  if (!team) {
    throw new ValidationError(`unknown team: ${input.teamId}`);
  }
  const provider = assertProvider(input.provider);
  const providerTeamId = input.providerTeamId?.trim() ?? "";
  if (providerTeamId === "") {
    throw new ValidationError("providerTeamId is required");
  }
  const confidence = input.confidence ?? 1;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new ValidationError("confidence must be between 0 and 1");
  }
  const status = input.status === undefined ? "confirmed" : assertStatus(input.status);
  const source = input.source ?? "manual";
  if (!(MAPPING_SOURCES as readonly string[]).includes(source)) {
    throw new ValidationError(`source must be one of: ${MAPPING_SOURCES.join(", ")}`);
  }
  const mapping = await repo.upsertMapping({
    teamId: team.id,
    provider,
    providerTeamId,
    rawName: input.rawName?.trim() || team.name,
    country: input.country ?? team.country,
    confidence,
    status,
    source,
  });
  if (status === "confirmed" && mapping.rawName !== "") {
    await repo.addAlias(team.id, mapping.rawName, "alias");
  }
  return mapping;
};

export const setMappingStatus = async (
  mappingId: string,
  status: string,
): Promise<TeamProviderMapping> => {
  const next = assertStatus(status);
  const updated = await repo.setMappingStatus(mappingId, next);
  if (!updated) {
    throw new ValidationError(`unknown mapping: ${mappingId}`);
  }
  if (next === "confirmed" && updated.rawName !== "") {
    await repo.addAlias(updated.teamId, updated.rawName, "alias");
  }
  return updated;
};

export const upsertFixtureLink = async (input: UpsertFixtureLinkInput): Promise<FixtureLink> => {
  if (!isIsoDate(input.matchDate)) {
    throw new ValidationError("matchDate must be a valid ISO date (YYYY-MM-DD)");
  }
  const home = await repo.getTeam(input.homeTeamId);
  if (!home) throw new ValidationError(`unknown home team: ${input.homeTeamId}`);
  const away = await repo.getTeam(input.awayTeamId);
  if (!away) throw new ValidationError(`unknown away team: ${input.awayTeamId}`);
  if (input.direttaMatchId === null || input.direttaMatchId === undefined) {
    if (input.apiFootballFixtureId === null || input.apiFootballFixtureId === undefined) {
      throw new ValidationError("at least one of direttaMatchId or apiFootballFixtureId is required");
    }
  }
  let kickoffAt: string | null = null;
  if (input.kickoffAt !== null && input.kickoffAt !== undefined) {
    const parsed = new Date(input.kickoffAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new ValidationError("kickoffAt must be a valid ISO datetime");
    }
    kickoffAt = parsed.toISOString();
  }
  return repo.upsertFixtureLink({ ...input, kickoffAt });
};

export const resolveFixture = async (
  matchDate: string,
  homeTeamId: string,
  awayTeamId: string,
): Promise<FixtureLink | null> => {
  if (!isIsoDate(matchDate)) {
    throw new ValidationError("matchDate must be a valid ISO date (YYYY-MM-DD)");
  }
  return repo.getFixtureLink(matchDate, homeTeamId, awayTeamId);
};

export const upsertLeagueLink = async (input: UpsertLeagueLinkInput): Promise<LeagueLink> => {
  if (!Number.isInteger(input.apiFootballLeagueId) || input.apiFootballLeagueId <= 0) {
    throw new ValidationError("apiFootballLeagueId must be a positive integer");
  }
  return repo.upsertLeagueLink(input);
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const syncSeason = async (input: SyncSeasonInput): Promise<SyncSeasonReport> => {
  if (!Number.isInteger(input.leagueId) || input.leagueId <= 0) {
    throw new ValidationError("leagueId must be a positive integer");
  }
  if (input.season !== undefined && (!Number.isInteger(input.season) || input.season < 1800)) {
    throw new ValidationError("season must be a valid year");
  }
  const dryRun = input.dryRun ?? false;
  const maxFixtures = input.maxFixtures ?? 0;

  const league = await af.getLeague(input.leagueId);
  const season = af.resolveSeason(league, input.season);
  const existingLink = await repo.getLeagueLink(input.leagueId);
  const direttaTournamentId =
    input.direttaTournamentId?.trim() || existingLink?.direttaTournamentId || undefined;

  if (!dryRun) {
    await repo.upsertLeagueLink({
      apiFootballLeagueId: input.leagueId,
      direttaTournamentId,
      name: league.league.name,
    });
  }

  const report: SyncSeasonReport = {
    league: {
      apiFootballId: league.league.id,
      name: league.league.name,
      country: league.country.name,
      season: season.year,
      seasonStart: season.start,
      seasonEnd: season.end,
      current: season.current,
    },
    dryRun,
    teams: { seen: 0, created: 0, mapped: 0 },
    fixtures: { seen: 0, created: 0, updated: 0, skipped: 0 },
    errors: [],
  };

  const teamIds = new Map<number, string>();
  const teamEntries = await af.listTeams(input.leagueId, season.year);
  report.teams.seen = teamEntries.length;

  for (const entry of teamEntries) {
    const providerTeamId = String(entry.team.id);
    const name = entry.team.name;
    const country = entry.team.country ?? league.country.name;
    try {
      const existing = await repo.findMapping("api_football", providerTeamId);
      if (existing) {
        teamIds.set(entry.team.id, existing.teamId);
        report.teams.mapped += 1;
        continue;
      }

      const normalized = normalizeTeamName(name);
      const aliasMatches = normalized === "" ? [] : await repo.findTeamsByNormalizedAlias(normalized);
      let teamId: string;
      if (aliasMatches.length === 1) {
        teamId = aliasMatches[0]!.id;
      } else if (dryRun) {
        teamIds.set(entry.team.id, `dry-run:${entry.team.id}`);
        report.teams.created += 1;
        continue;
      } else {
        const team = await createTeam({ name, country });
        teamId = team.id;
        report.teams.created += 1;
      }

      if (!dryRun) {
        await repo.upsertMapping({
          teamId,
          provider: "api_football",
          providerTeamId,
          rawName: name,
          country,
          confidence: 1,
          status: "confirmed",
          source: "id",
        });
      }
      teamIds.set(entry.team.id, teamId);
      report.teams.mapped += 1;
    } catch (error) {
      if (report.errors.length < 50) {
        report.errors.push(`team ${providerTeamId} (${name}): ${errorMessage(error)}`);
      }
    }
  }

  const allFixtures = await af.listFixtures(input.leagueId, season.year);
  const fixtures = maxFixtures > 0 ? allFixtures.slice(0, maxFixtures) : allFixtures;
  report.fixtures.seen = fixtures.length;

  for (const fixture of fixtures) {
    const fixtureId = String(fixture.fixture.id);
    try {
      const homeTeamId = teamIds.get(fixture.teams.home.id);
      const awayTeamId = teamIds.get(fixture.teams.away.id);
      if (homeTeamId === undefined || awayTeamId === undefined) {
        report.fixtures.skipped += 1;
        if (report.errors.length < 50) {
          report.errors.push(`fixture ${fixtureId}: team canonico non risolto`);
        }
        continue;
      }

      const matchDate = fixture.fixture.date.slice(0, 10);
      if (!isIsoDate(matchDate)) {
        report.fixtures.skipped += 1;
        if (report.errors.length < 50) {
          report.errors.push(`fixture ${fixtureId}: data non valida (${fixture.fixture.date})`);
        }
        continue;
      }

      if (dryRun) {
        const existing = await repo.getFixtureLinkByApiFootballId(fixtureId);
        if (existing) report.fixtures.updated += 1;
        else report.fixtures.created += 1;
        continue;
      }

      const existing = await repo.getFixtureLink(matchDate, homeTeamId, awayTeamId);

      await repo.upsertFixtureLink({
        matchDate,
        homeTeamId,
        awayTeamId,
        apiFootballFixtureId: fixtureId,
        kickoffAt: fixture.fixture.date,
      });
      if (existing) report.fixtures.updated += 1;
      else report.fixtures.created += 1;
    } catch (error) {
      report.fixtures.skipped += 1;
      if (report.errors.length < 50) {
        report.errors.push(`fixture ${fixtureId}: ${errorMessage(error)}`);
      }
    }
  }

  return report;
};
