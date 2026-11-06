import { ValidationError } from "../errors.ts";
import { isIsoDate } from "../validation.ts";
import * as af from "../clients/apifootball/client.ts";
import { client as feedClient } from "../clients/diretta/index.ts";
import { listMatches } from "../clients/diretta/matches.ts";
import { configuredMajorLeagues, isMajorLeague } from "../services/strategies/major_leagues.ts";
import { normalizeTeamName, rankCandidates } from "./normalize.ts";
import * as repo from "./repo.ts";
import {
  MAPPING_SOURCES,
  MAPPING_STATUSES,
  PROVIDERS,
  type AutoSyncLeagueCandidate,
  type AutoSyncLeaguesInput,
  type AutoSyncLeaguesReport,
  type CreateTeamInput,
  type FixtureLink,
  type LeagueLink,
  type MappingStatus,
  type Provider,
  type ProviderTeamSyncCounts,
  type ResolveTeamInput,
  type ResolveTeamResult,
  type SyncSeasonInput,
  type SyncSeasonReport,
  type SyncTeamsInput,
  type SyncTeamsReport,
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

const extractCountryFromTournament = (tournament: string): string | undefined => {
  const [country] = tournament.split(":");
  const trimmed = country?.trim();
  if (!trimmed) return undefined;
  if (trimmed.toUpperCase() === "EUROPA" || trimmed.toUpperCase() === "MONDO") return undefined;
  return trimmed;
};

const normalizeForMatch = (value: string): string =>
  normalizeTeamName(value)
    .replace(/\b(uefa|champions league|europa league|conference league|nations league|premier league|liga|serie|bundesliga|ligue|eredivisie|superliga|primeira|la liga)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

const scoreLeagueMatch = (direttaName: string, direttaCountry: string | undefined, league: af.AfLeague): number => {
  const leagueNameNorm = normalizeForMatch(league.league.name);
  const dirNorm = normalizeForMatch(direttaName);
  if (dirNorm === "" || leagueNameNorm === "") return 0;
  if (dirNorm === leagueNameNorm) return 1;
  if (dirNorm.includes(leagueNameNorm) || leagueNameNorm.includes(dirNorm)) {
    const base = 0.9;
    if (direttaCountry && league.country.name.toLowerCase() === direttaCountry.toLowerCase()) {
      return base + 0.05;
    }
    return base;
  }
  if (direttaCountry && league.country.name.toLowerCase() === direttaCountry.toLowerCase()) {
    if (leagueNameNorm.split(" ").some((token) => token.length > 3 && dirNorm.includes(token))) {
      return 0.8;
    }
  }
  return 0;
};

export const autoSyncLeaguesFromMonitoring = async (
  input: AutoSyncLeaguesInput = {},
): Promise<AutoSyncLeaguesReport> => {
  if (input.runSeasonSync !== false && input.runTeamsSync !== false) {
    // defaults allow both; user can disable
  }
  const dryRun = input.dryRun ?? true;
  const apply = input.apply ?? false;
  const runSeasonSync = input.runSeasonSync ?? true;
  const runTeamsSync = input.runTeamsSync ?? true;
  const allowlist = configuredMajorLeagues();

  const report: AutoSyncLeaguesReport = {
    dryRun,
    applied: apply,
    fetchedDiretta: 0,
    relevant: 0,
    alreadyLinked: 0,
    matched: 0,
    createdLinks: 0,
    failed: 0,
    errors: [],
    results: [],
  };

  let matches;
  try {
    matches = await feedClient.listMatches(1);
  } catch (error) {
    throw new ValidationError(`Impossibile recuperare partite diretta: ${errorMessage(error)}`);
  }
  report.fetchedDiretta = matches.length;

  const grouped = new Map<
    string,
    { tournamentId: string; tournament: string; country?: string; count: number }
  >();
  for (const match of matches) {
    if (!isMajorLeague(match, allowlist)) continue;
    const tournamentId = (match.tournament_id ?? "").trim();
    const tournament = (match.tournament ?? "").trim();
    if (tournamentId === "" || tournament === "") continue;
    const key = tournamentId;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    grouped.set(key, {
      tournamentId,
      tournament,
      country: extractCountryFromTournament(tournament),
      count: 1,
    });
  }

  const relevant = [...grouped.values()];
  report.relevant = relevant.length;

  const leagueLinks = await repo.listLeagueLinks();
  const linkedByDiretta = new Map<string, LeagueLink>();
  for (const link of leagueLinks) {
    if (link.direttaTournamentId) {
      linkedByDiretta.set(link.direttaTournamentId, link);
    }
  }

  let candidatesPool: af.AfLeague[] = [];
  try {
    candidatesPool = await af.listLeagues();
  } catch (error) {
    if (report.errors.length < 50) {
      report.errors.push(`listLeagues: ${errorMessage(error)}`);
    }
  }

  for (const item of relevant) {
    const already = linkedByDiretta.get(item.tournamentId);
    if (already) {
      report.alreadyLinked += 1;
      const result: AutoSyncLeaguesReport["results"][number] = {
        direttaTournamentId: item.tournamentId,
        tournament: item.tournament,
        country: item.country,
        status: "already_linked",
        apiFootballLeagueId: already.apiFootballLeagueId,
        apiFootballLeagueName: already.name ?? undefined,
      };
      if (apply && !dryRun) {
        try {
          let seasonSync: SyncSeasonReport | null = null;
          let teamsSync: SyncTeamsReport | null = null;
          if (runSeasonSync) {
            seasonSync = await syncSeason({
              leagueId: already.apiFootballLeagueId,
              season: input.season,
              direttaTournamentId: item.tournamentId,
            });
          }
          if (runTeamsSync) {
            teamsSync = await syncTeams({
              leagueId: already.apiFootballLeagueId,
              season: input.season,
              direttaTournamentId: item.tournamentId,
            });
          }
          result.status = "synced";
          result.seasonSync = seasonSync;
          result.teamsSync = teamsSync;
        } catch (error) {
          report.failed += 1;
          result.error = errorMessage(error);
          if (report.errors.length < 50) {
            report.errors.push(`${item.tournamentId}: ${errorMessage(error)}`);
          }
        }
      } else {
        result.status = dryRun ? "already_linked" : "skipped";
      }
      report.results.push(result);
      continue;
    }

    let best: { league: af.AfLeague; score: number } | null = null;
    for (const league of candidatesPool) {
      const score = scoreLeagueMatch(item.tournament, item.country, league);
      if (score === 0) continue;
      if (!best || score > best.score) {
        best = { league, score };
      } else if (score === best.score && item.country && league.country.name.toLowerCase() === item.country.toLowerCase()) {
        best = { league, score };
      }
    }

    if (!best || best.score < 0.7) {
      report.failed += 1;
      report.results.push({
        direttaTournamentId: item.tournamentId,
        tournament: item.tournament,
        country: item.country,
        status: "unmatched",
        error: best ? `score troppo basso (${best.score.toFixed(2)})` : "nessun candidato trovato",
      });
      if (report.errors.length < 50) {
        report.errors.push(`${item.tournamentId} (${item.tournament}): nessun match API-Football`);
      }
      continue;
    }

    report.matched += 1;
    if (!apply || dryRun) {
      report.results.push({
        direttaTournamentId: item.tournamentId,
        tournament: item.tournament,
        country: item.country,
        status: "matched",
        apiFootballLeagueId: best.league.league.id,
        apiFootballLeagueName: best.league.league.name,
        apiFootballCountry: best.league.country.name,
        score: best.score,
      });
      continue;
    }

    try {
      await repo.upsertLeagueLink({
        apiFootballLeagueId: best.league.league.id,
        direttaTournamentId: item.tournamentId,
        name: best.league.league.name,
      });
      report.createdLinks += 1;
      let seasonSync: SyncSeasonReport | null = null;
      let teamsSync: SyncTeamsReport | null = null;
      if (runSeasonSync) {
        seasonSync = await syncSeason({
          leagueId: best.league.league.id,
          season: input.season,
          direttaTournamentId: item.tournamentId,
        });
      }
      if (runTeamsSync) {
        teamsSync = await syncTeams({
          leagueId: best.league.league.id,
          season: input.season,
          direttaTournamentId: item.tournamentId,
        });
      }
      report.results.push({
        direttaTournamentId: item.tournamentId,
        tournament: item.tournament,
        country: item.country,
        status: "synced",
        apiFootballLeagueId: best.league.league.id,
        apiFootballLeagueName: best.league.league.name,
        apiFootballCountry: best.league.country.name,
        score: best.score,
        seasonSync,
        teamsSync,
      });
    } catch (error) {
      report.failed += 1;
      report.results.push({
        direttaTournamentId: item.tournamentId,
        tournament: item.tournament,
        country: item.country,
        status: "matched",
        apiFootballLeagueId: best.league.league.id,
        apiFootballLeagueName: best.league.league.name,
        apiFootballCountry: best.league.country.name,
        score: best.score,
        error: errorMessage(error),
      });
      if (report.errors.length < 50) {
        report.errors.push(`${item.tournamentId}: ${errorMessage(error)}`);
      }
    }
  }

  return report;
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

const emptyTeamCounts = (): ProviderTeamSyncCounts => ({
  seen: 0,
  created: 0,
  mapped: 0,
  pending: 0,
  unmatched: 0,
});

interface ProviderTeamEntry {
  providerTeamId: string;
  name: string;
  country: string;
}

const syncProviderTeams = async (
  provider: Provider,
  entries: ProviderTeamEntry[],
  dryRun: boolean,
  errors: string[],
): Promise<{ counts: ProviderTeamSyncCounts; teamIds: Map<string, string> }> => {
  const counts = emptyTeamCounts();
  counts.seen = entries.length;
  const teamIds = new Map<string, string>();

  for (const entry of entries) {
    const { providerTeamId, name, country } = entry;
    try {
      const existing = await repo.findMapping(provider, providerTeamId);
      if (existing) {
        if (existing.status === "rejected") {
          counts.unmatched += 1;
          if (errors.length < 50) {
            errors.push(`${provider} team ${providerTeamId} (${name}): mapping rifiutata`);
          }
          continue;
        }
        teamIds.set(providerTeamId, existing.teamId);
        if (existing.status === "pending") {
          counts.pending += 1;
        } else {
          counts.mapped += 1;
        }
        continue;
      }

      const resolved = await resolveTeam({
        provider,
        providerTeamId,
        name,
        country,
        autoLink: !dryRun,
      });

      if (resolved.status === "matched" && resolved.team) {
        teamIds.set(providerTeamId, resolved.team.id);
        counts.mapped += 1;
        continue;
      }

      if (resolved.status === "pending") {
        counts.pending += 1;
        if (resolved.team) {
          teamIds.set(providerTeamId, resolved.team.id);
        } else if (errors.length < 50) {
          errors.push(`${provider} team ${providerTeamId} (${name}): match ambiguo, revisione manuale`);
        }
        continue;
      }

      if (resolved.status === "rejected") {
        counts.unmatched += 1;
        if (errors.length < 50) {
          errors.push(`${provider} team ${providerTeamId} (${name}): mapping rifiutata`);
        }
        continue;
      }

      counts.created += 1;
      if (dryRun) {
        continue;
      }
      const team = await createTeam({ name, country });
      teamIds.set(providerTeamId, team.id);
      await repo.upsertMapping({
        teamId: team.id,
        provider,
        providerTeamId,
        rawName: name,
        country,
        confidence: 1,
        status: "confirmed",
        source: "id",
      });
    } catch (error) {
      counts.unmatched += 1;
      if (errors.length < 50) {
        errors.push(`${provider} team ${providerTeamId} (${name}): ${errorMessage(error)}`);
      }
    }
  }

  return { counts, teamIds };
};

export const syncTeams = async (input: SyncTeamsInput): Promise<SyncTeamsReport> => {
  if (!Number.isInteger(input.leagueId) || input.leagueId <= 0) {
    throw new ValidationError("leagueId must be a positive integer");
  }
  if (input.season !== undefined && (!Number.isInteger(input.season) || input.season < 1800)) {
    throw new ValidationError("season must be a valid year");
  }
  const dryRun = input.dryRun ?? false;

  const league = await af.getLeague(input.leagueId);
  const season = af.resolveSeason(league, input.season);
  const existingLink = await repo.getLeagueLink(input.leagueId);
  const direttaTournamentId =
    input.direttaTournamentId?.trim() || existingLink?.direttaTournamentId || "";
  if (direttaTournamentId === "") {
    throw new ValidationError(
      "direttaTournamentId is required (or set it once via /mapping/seasons/sync)",
    );
  }

  if (!dryRun) {
    await repo.upsertLeagueLink({
      apiFootballLeagueId: input.leagueId,
      direttaTournamentId,
      name: league.league.name,
    });
  }

  const report: SyncTeamsReport = {
    league: {
      apiFootballId: league.league.id,
      name: league.league.name,
      country: league.country.name,
      season: season.year,
      seasonStart: season.start,
      seasonEnd: season.end,
      current: season.current,
    },
    direttaTournamentId,
    dryRun,
    apiFootball: emptyTeamCounts(),
    diretta: emptyTeamCounts(),
    errors: [],
  };

  const apiTeams = await af.listTeams(input.leagueId, season.year);
  const apiSync = await syncProviderTeams(
    "api_football",
    apiTeams.map((entry) => ({
      providerTeamId: String(entry.team.id),
      name: entry.team.name,
      country: entry.team.country ?? league.country.name,
    })),
    dryRun,
    report.errors,
  );
  report.apiFootball = apiSync.counts;

  const matches = await listMatches(1);
  const direttaTeams = new Map<string, ProviderTeamEntry>();
  for (const match of matches) {
    if ((match.tournament_id ?? "") !== direttaTournamentId) {
      continue;
    }
    const country = match.country || league.country.name;
    if (match.home_id && match.home) {
      direttaTeams.set(match.home_id, { providerTeamId: match.home_id, name: match.home, country });
    }
    if (match.away_id && match.away) {
      direttaTeams.set(match.away_id, { providerTeamId: match.away_id, name: match.away, country });
    }
  }

  const direttaSync = await syncProviderTeams(
    "diretta",
    [...direttaTeams.values()],
    dryRun,
    report.errors,
  );
  report.diretta = direttaSync.counts;

  return report;
};
