import { getSettings, type Settings } from "../config.ts";
import { ConflictError, baseResponse } from "../errors.ts";
import type { BaseResponse } from "../types.ts";
import { client as feedClient, FeedError } from "../clients/diretta/index.ts";
import * as db from "../scraper/db.ts";
import type { Match } from "../scraper/models.ts";
import { defaultSchedulerClient, type SchedulerClient } from "../cloud_scheduler/client.ts";
import { buildCron, cronHitsDay } from "./cron.ts";
import { getLogger, type AppLogger } from "../logger.ts";
import { listTodayFixtures, type ApiFootballFixture } from "./api_football.ts";
import { upsertScheduledFixtures, initScheduledFixturesRepo } from "./scheduled_fixtures_repo.ts";
import { getTeams } from "../services/teams_repo.ts";
import { listLeagueLinks } from "../mapping/repo.ts";
import type { LeagueLink } from "../mapping/models.ts";
import { normalizeTeamName } from "../mapping/normalize.ts";

const SPORT_CALCIO = 1;
const FALLBACK_END_OFFSET_SECONDS = 2 * 60 * 60;
const DETAIL_WORKERS = 4;

const asEpoch = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return Math.floor(date.getTime() / 1000);
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const pool = async <T>(items: readonly T[], workers: number, fn: (item: T) => Promise<void>): Promise<void> => {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(workers, queue.length) }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) {
        return;
      }
      await fn(item);
    }
  });
  await Promise.all(runners);
};

const missingSchedulerSettings = (settings: Settings): string[] => {
  const missing: string[] = [];
  if (settings.gcpProjectId === "") missing.push("GCP_PROJECT_ID");
  if (settings.gcpJobId === "") missing.push("GCP_JOB_ID");
  if (settings.monitorJobTargetBaseUrl === "") missing.push("MONITOR_JOB_TARGET_BASE_URL");
  return missing;
};

const schedulerEnabled = (settings: Settings): boolean => {
  return missingSchedulerSettings(settings).length === 0;
}

interface MatchedFixture {
  fixture: ApiFootballFixture;
  direttaMatch: Match;
  leagueLink: LeagueLink;
}

const enrichWindows = async (matches: Match[], leadMinutes: number, log: AppLogger): Promise<void> => {
  await pool(matches, DETAIL_WORKERS, async (match) => {
    const start = asEpoch(match.start_time);
    if (start === null) {
      log.warn({ matchId: match.id, tournament: match.tournament }, "match skipped: missing start_time");
      return;
    }
    let endTime: number | null = null;
    try {
      const detail = await feedClient.getMatch(match.id);
      match.detail = detail;
      endTime = asEpoch(detail["end_time"]);
      if (endTime !== null && endTime <= 0) endTime = null;
      if (endTime === null) {
        log.warn({ matchId: match.id, home: match.home, away: match.away }, "match detail has no end_time: falling back to start + 2h");
      }
    } catch (exc) {
      if (!(exc instanceof FeedError)) throw exc;
      log.warn({ err: exc, matchId: match.id, home: match.home, away: match.away }, "match detail feed failed: falling back to start + 2h");
    }
    match["begin_monitoring_time"] = start - leadMinutes * 60;
    match["end_monitoring_time"] = endTime ?? start + FALLBACK_END_OFFSET_SECONDS;
    match["monitored"] = true;
    log.debug({ matchId: match.id, home: match.home, away: match.away, startTime: start, beginMonitoringTime: match["begin_monitoring_time"], endMonitoringTime: match["end_monitoring_time"], usedFallbackEnd: endTime === null }, "monitoring window computed");
  });
}

export const autoScheduleEvents = async (
  scheduler: SchedulerClient = defaultSchedulerClient(),
  log: AppLogger = getLogger(),
): Promise<BaseResponse> => {
  initScheduledFixturesRepo();
  
  const settings = getSettings();
  const now = new Date();
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD

  log.info(
    {
      now: now.toISOString(),
      sport: SPORT_CALCIO,
      schedulerEnabled: missingSchedulerSettings(settings).length === 0,
      missingSchedulerSettings: missingSchedulerSettings(settings),
      gcpProjectId: settings.gcpProjectId,
      gcpRegion: settings.gcpRegion,
      gcpJobId: settings.gcpJobId,
      monitorJobTargetBaseUrl: settings.monitorJobTargetBaseUrl,
      schedulerTimeZone: settings.schedulerTimeZone,
      monitorLeadMinutes: settings.monitorLeadMinutes,
      schedulerCronStepMinutes: settings.schedulerCronStepMinutes,
      date: today,
    },
    "auto-schedule started (league-links driven)",
  );

  try {
    // 1. Carica i link di lega da Supabase: mappa api_football_league_id -> diretta_tournament_id
    const leagueLinks = await listLeagueLinks();
    const linkByApiLeagueId = new Map<number, LeagueLink>(leagueLinks.map((l) => [l.apiFootballLeagueId, l]));
    const direttaTournamentIds = new Set<string>(
      leagueLinks.map((l) => l.direttaTournamentId).filter((id): id is string => id !== null && id !== ""),
    );

    log.info(
      { leagueLinks: leagueLinks.length, direttaTournamentIds: [...direttaTournamentIds] },
      "league links loaded",
    );

    // 2. Recupera le partite da Diretta e filtra per diretta_tournament_id (campo sui league_links)
    const direttaMatches = await feedClient.listMatches(SPORT_CALCIO);
    const direttaMatchesByTournament = new Map<string, Match[]>();
    for (const match of direttaMatches) {
      const tid = match.tournament_id;
      if (tid && direttaTournamentIds.has(tid)) {
        const arr = direttaMatchesByTournament.get(tid) ?? [];
        arr.push(match);
        direttaMatchesByTournament.set(tid, arr);
      }
    }
    log.info({ direttaFetched: direttaMatches.length, direttaFiltered: direttaMatchesByTournament.size }, "Diretta matches filtered by diretta_tournament_id");

    // Carica le squadre dal repo teams: diretta_name -> team (bridge col feed Diretta)
    // e api_football_id -> team (bridge con API Football).
    const teams = await getTeams();
    const direttaNameToTeam = new Map<string, typeof teams[number]>();
    const apiFootballIdToTeam = new Map<number, typeof teams[number]>();
    for (const team of teams) {
      direttaNameToTeam.set(normalizeTeamName(team.diretta_name), team);
      if (team.api_football_id !== null) {
        apiFootballIdToTeam.set(team.api_football_id, team);
      }
    }

    const resolveDirettaTeams = (m: Match): { home: typeof teams[number] | null; away: typeof teams[number] | null } => ({
      home: direttaNameToTeam.get(normalizeTeamName(m.home ?? "")) ?? null,
      away: direttaNameToTeam.get(normalizeTeamName(m.away ?? "")) ?? null,
    });

    // Indicizza le partite Diretta per torneo + coppia di squadre (via diretta_name).
    const direttaByTournamentAndPair = new Map<string, Map<string, Match>>();
    for (const match of direttaMatches) {
      const tid = match.tournament_id;
      if (!tid || !direttaTournamentIds.has(tid)) continue;
      const { home, away } = resolveDirettaTeams(match);
      if (!home || !away) continue;
      let byPair = direttaByTournamentAndPair.get(tid);
      if (!byPair) {
        byPair = new Map();
        direttaByTournamentAndPair.set(tid, byPair);
      }
      const pairKey = [home.id, away.id].sort().join("|");
      byPair.set(pairKey, match);
    }

    // 3. Recupera le partite da API Football (drives the logic)
    const apiFixtures = await listTodayFixtures(today);
    log.info({ fetched: apiFixtures.length, date: today }, "API Football fixtures fetched");

    if (apiFixtures.length === 0) {
      log.warn({ date: today }, "no fixtures from API Football for today");
      if (schedulerEnabled(settings)) {
        log.info({ jobId: settings.gcpJobId }, "deleting scheduler job: no fixtures");
        await scheduler.deleteJob(settings.gcpJobId);
      }
      return baseResponse("Auto-schedule completed: no fixtures from API Football", 200);
    }

    // 4. Filtra le API Football per campionato monitorato e associa la partita Diretta
    //    tramite le squadre del repo teams (diretta_name + api_football_id).
    const validFixtures: MatchedFixture[] = [];
    const rejectedLeagues: { tournament: string; count: number }[] = [];
    const rejectedLeagueMap = new Map<string, number>();
    let missingStartTime = 0;
    let alreadyStarted = 0;
    let noLeagueLink = 0;
    let noDirettaMatch = 0;

    for (const fixture of apiFixtures) {
      const leagueId = fixture.league.id;
      const leagueLink = linkByApiLeagueId.get(leagueId);
      if (!leagueLink) {
        noLeagueLink += 1;
        const leagueName = `${fixture.league.country}: ${fixture.league.name}`;
        rejectedLeagueMap.set(leagueName, (rejectedLeagueMap.get(leagueName) ?? 0) + 1);
        continue;
      }
      if (!leagueLink.direttaTournamentId) {
        noLeagueLink += 1;
        const leagueName = `${fixture.league.country}: ${fixture.league.name}`;
        rejectedLeagueMap.set(leagueName, (rejectedLeagueMap.get(leagueName) ?? 0) + 1);
        continue;
      }

      const start = asEpoch(fixture.fixture.date);
      if (start === null) {
        missingStartTime += 1;
        continue;
      }
      if (start < nowEpoch) {
        alreadyStarted += 1;
        continue;
      }

      const homeTeam = apiFootballIdToTeam.get(fixture.teams.home.id);
      const awayTeam = apiFootballIdToTeam.get(fixture.teams.away.id);
      let direttaMatch: Match | null = null;
      if (homeTeam && awayTeam) {
        const byPair = direttaByTournamentAndPair.get(leagueLink.direttaTournamentId);
        if (byPair) {
          const pairKey = [homeTeam.id, awayTeam.id].sort().join("|");
          direttaMatch = byPair.get(pairKey) ?? null;
        }
      }
      // Fallback: match diretto per nome normalizzato quando le squadre non sono in tabella teams
      if (!direttaMatch) {
        const normHome = normalizeTeamName(fixture.teams.home.name);
        const normAway = normalizeTeamName(fixture.teams.away.name);
        const candidates = direttaMatchesByTournament.get(leagueLink.direttaTournamentId) ?? [];
        direttaMatch = candidates.find((m) => {
          const dHome = normalizeTeamName(m.home ?? "");
          const dAway = normalizeTeamName(m.away ?? "");
          return (
            (dHome.includes(normHome) && dAway.includes(normAway)) ||
            (dHome.includes(normAway) && dAway.includes(normHome))
          );
        }) ?? null;
      }
      if (!direttaMatch) {
        noDirettaMatch += 1;
        log.warn({ fixtureId: fixture.fixture.id, home: fixture.teams.home.name, away: fixture.teams.away.name, league: `${fixture.league.country}: ${fixture.league.name}`, direttaTournamentId: leagueLink.direttaTournamentId }, "no Diretta match found for fixture");
        continue;
      }

      validFixtures.push({ fixture, direttaMatch, leagueLink });

      log.debug(
        {
          fixtureId: fixture.fixture.id,
          matchId: direttaMatch.id,
          home: fixture.teams.home.name,
          away: fixture.teams.away.name,
          league: `${fixture.league.country}: ${fixture.league.name}`,
          direttaTournamentId: leagueLink.direttaTournamentId,
          kickoff: new Date(start * 1000).toISOString(),
        },
        "fixture matched and ready for scheduling"
      );
    }

    const rejectedByLeague = Array.from(rejectedLeagueMap.entries()).map(([tournament, count]) => ({ tournament, count }));

    log.info(
      {
        fetched: apiFixtures.length,
        valid: validFixtures.length,
        rejectedByLeague: rejectedByLeague.reduce((sum, r) => sum + r.count, 0),
        missingStartTime,
        alreadyStarted,
        noLeagueLink,
        noDirettaMatch,
        leagueLinks: leagueLinks.length,
      },
      "fixture selection completed",
    );

    if (validFixtures.length === 0) {
      log.warn(
        {
          fetched: apiFixtures.length,
          rejectedByLeague,
          missingStartTime,
          alreadyStarted,
          noLeagueLink,
          noDirettaMatch,
          leagueLinks: leagueLinks.length,
        },
        "no valid fixtures to schedule",
      );
      if (schedulerEnabled(settings)) {
        log.info({ jobId: settings.gcpJobId }, "deleting scheduler job: no valid fixtures");
        await scheduler.deleteJob(settings.gcpJobId);
      }
      return baseResponse("Auto-schedule completed: no valid fixtures to schedule", 200);
    }

    // 5. Arricchisci le finestre di monitoraggio recuperando i dettagli Diretta (end_time)
    log.info({ count: validFixtures.length, leadMinutes: settings.monitorLeadMinutes }, "enriching monitoring windows");

    const matchesToEnrich: Match[] = validFixtures.map((f) => ({
      id: f.direttaMatch.id,
      home: f.fixture.teams.home.name,
      away: f.fixture.teams.away.name,
      tournament: `${f.fixture.league.country}: ${f.fixture.league.name}`,
      start_time: asEpoch(f.fixture.fixture.date) ?? 0,
      sport: SPORT_CALCIO,
    }));

    await enrichWindows(matchesToEnrich, settings.monitorLeadMinutes, log);

    // 6. Salva su scheduled_fixtures con sia matchId (Diretta) che fixtureId (API Football)
    const fixturesToStore = validFixtures.map((f, idx) => {
      const enriched = matchesToEnrich[idx];
      if (!enriched) throw new Error(`Missing enriched match at index ${idx}`);
      return {
        fixture_id: f.fixture.fixture.id,
        match_id: enriched.id, // Diretta match ID
        api_football_league_id: f.fixture.league.id,
        api_football_league_name: `${f.fixture.league.country}: ${f.fixture.league.name}`,
        home_team: f.fixture.teams.home.name,
        away_team: f.fixture.teams.away.name,
        kickoff_time: new Date((asEpoch(f.fixture.fixture.date) ?? 0) * 1000).toISOString(),
        begin_monitoring_time: new Date((asEpoch(enriched["begin_monitoring_time"]) ?? 0) * 1000).toISOString(),
        end_monitoring_time: new Date((asEpoch(enriched["end_monitoring_time"]) ?? 0) * 1000).toISOString(),
        status: "scheduled",
      };
    });

    const stored = await upsertScheduledFixtures(fixturesToStore);
    log.info({ count: validFixtures.length, stored }, "scheduled fixtures persisted");

    // 7. Persisti anche sulla tabella matches per retro-compatibilità con il monitoraggio
    const storedMatches = await db.upsertMatches(matchesToEnrich);
    log.info({ count: matchesToEnrich.length, stored: storedMatches }, "matches persisted for monitoring");

    // 8. Costruisci il cron dalle finestre di monitoraggio
    const windows = matchesToEnrich.map((match) => ({
      begin: asEpoch(match["begin_monitoring_time"]) ?? 0,
      end: asEpoch(match["end_monitoring_time"]) ?? 0,
    }));
    const cron = buildCron(windows, settings.schedulerTimeZone, now, settings.schedulerCronStepMinutes);
    log.info(
      {
        windows: windows.length,
        cron,
        timeZone: settings.schedulerTimeZone,
        stepMinutes: settings.schedulerCronStepMinutes,
        monitoringWindows: windows,
      },
      "cron expression computed",
    );
    if (cron === null) {
      log.warn({ windows: windows.length }, "no future monitoring window left: cron not scheduled");
      return baseResponse(
        `Auto-schedule completed: ${validFixtures.length} fixtures monitored, no future start times left to schedule`,
        200,
      );
    }

    if (missingSchedulerSettings(settings).length > 0) {
      log.warn({ missing: missingSchedulerSettings(settings), cron }, "cloud scheduler not configured: job not created");
      return baseResponse(
        `Auto-schedule completed: ${validFixtures.length} fixtures monitored (Cloud Scheduler not configured, cron ${cron})`,
        200,
      );
    }

    const input = {
      schedule: cron,
      timeZone: settings.schedulerTimeZone,
      httpTarget: {
        httpMethod: "GET",
        uri: `${settings.monitorJobTargetBaseUrl.replace(/\/+$/, "")}/api/v1/monitor`,
      },
    };

    const existing = await scheduler.getJob(settings.gcpJobId);
    log.info(
      {
        jobId: settings.gcpJobId,
        exists: existing !== null,
        existingSchedule: existing?.schedule ?? null,
        existingTimeZone: existing?.timeZone ?? null,
        existingUri: existing?.httpTarget?.uri ?? null,
      },
      "existing scheduler job fetched",
    );
    if (existing && cronHitsDay(existing.schedule, settings.schedulerTimeZone, now)) {
      log.warn(
        { jobId: settings.gcpJobId, existingSchedule: existing.schedule, cron },
        "auto-schedule already executed today: conflict",
      );
      throw new ConflictError(`Auto-schedule already executed for today (job ${settings.gcpJobId} fires today)`);
    }
    if (existing) {
      log.info(
        { jobId: settings.gcpJobId, schedule: cron, uri: input.httpTarget.uri, action: "update" },
        "updating cloud scheduler job",
      );
      await scheduler.updateJob(settings.gcpJobId, input);
    } else {
      log.info(
        { jobId: settings.gcpJobId, schedule: cron, uri: input.httpTarget.uri, action: "create" },
        "creating cloud scheduler job",
      );
      await scheduler.createJob(input);
    }
    const response = baseResponse(
      `Auto-schedule completed: ${validFixtures.length} fixtures monitored, job ${settings.gcpJobId} scheduled at ${cron}`,
      200,
    );
    log.info({ statusCode: response.statusCode, message: response.message }, "auto-schedule completed");
    return response;
  } catch (exc) {
    if (exc instanceof ConflictError) {
      log.warn({ err: exc }, "auto-schedule aborted: conflict");
    } else {
      log.error({ err: exc }, "auto-schedule failed");
    }
    throw exc;
  }
};
