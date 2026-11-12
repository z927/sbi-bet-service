import { client } from "../../clients/diretta/index.ts";
import type { Match, OddsMarketSelector, Statistics } from "../../scraper/models.ts";
import { getStrategyLogger, runWithLogContext, runWithNewLogTrace } from "../../logger.ts";
import { getLiveOdds, listLiveFixtures } from "../api_football.ts";
import { listLeagueLinks } from "../../mapping/repo.ts";
import { getScheduledFixture } from "../scheduled_fixtures_repo.ts";
import {
  attachLiveOdds,
  dispatchAlerts,
  evaluateSignalsWithPreAlert,
  isZeroZero,
  type Alert,
} from "../signals/index.ts";
import { touchSnapshot } from "../signals/touch_stats.ts";
import { matchPeriod } from "../signals/match_minutes.ts";
import type {
  Strategy,
  StrategyContext,
  StrategyMatchResult,
  StrategyResult,
} from "./strategy.ts";

export const LIVE_MATCHES_STRATEGY = "live-matches-statistics";

export interface LiveMatchesStrategyHooks {
  log: (match: Match, statistics: Statistics) => void;
}

const defaultHooks = (): LiveMatchesStrategyHooks => ({
  log: (match: Match, statistics: Statistics) => {
    getStrategyLogger().info(
      { matchId: match.id, home: match.home, away: match.away, statistics },
      `${match.home} - ${match.away}`,
    );
  },
});

interface MatchOutcome {
  statistics: Statistics | null;
  alerts: Alert[];
  error: string | null;
}

const API_FOOTBALL_STAGE: Record<string, number | null> = {
  "1H": 12,
  "2H": 13,
  "HT": 38,
  "FT": 3,
  "LIVE": null,
  "NS": null,
};

const findOverUnderOdd = (bookmakers: unknown[]): number | null => {
  for (const bm of bookmakers) {
    const bets = (bm as { bets?: unknown[] }).bets ?? [];
    for (const bet of bets) {
      const values = (bet as { values?: unknown[] }).values ?? [];
      for (const v of values) {
        const val = v as { value?: string; odd?: string | number };
        const odd = Number(val.odd);
        if (typeof val.value === "string" && val.value.toLowerCase().includes("over") && Number.isFinite(odd)) {
          return odd;
        }
      }
    }
  }
  return null;
};

const resolveApiFootballOdds = async (
  fixtureId: number,
  oddsMarket: OddsMarketSelector | undefined,
): Promise<number | null> => {
  if (!oddsMarket || oddsMarket.betType !== "OVER_UNDER" || oddsMarket.selection !== "OVER") {
    return null;
  }
  const odds = await getLiveOdds(fixtureId);
  const allBookmakers = odds.flatMap((o) => o.bookmakers ?? []);
  return findOverUnderOdd(allBookmakers);
};

const runMatch = async (
  match: Match,
  oddsResolver: (alert: Alert) => Promise<number | null>,
  hooks: LiveMatchesStrategyHooks,
): Promise<MatchOutcome> => {
    const log = getStrategyLogger();
    log.info({ matchId: match.id }, "match strategy started");
    try {
      if (!isZeroZero(match)) {
        log.info({ matchId: match.id, score: `${match.home_score ?? 0}-${match.away_score ?? 0}` }, "match strategy skipped (score not 0-0)");
        return { statistics: null, alerts: [], error: null };
      }
      const statistics = await client.getStatistics(match.id);
    hooks.log(match, statistics);
    const period = matchPeriod(match);
    const snapshot = period ? touchSnapshot(match, statistics, period) : null;
    log.info(
      {
        matchId: match.id,
        minute: match.minute,
        touches: snapshot?.touches ?? null,
        ratio: snapshot?.ratio ?? null,
      },
      "match touch stats",
    );
    const alerts = await evaluateSignalsWithPreAlert(match, statistics, undefined, { match, statistics });
    log.info(
      {
        matchId: match.id,
        alerts: alerts.length,
        touches: snapshot?.touches ?? null,
        ratio: snapshot?.ratio ?? null,
      },
      "match signals evaluated",
    );
    if (alerts.length > 0) {
      await attachLiveOdds(alerts, oddsResolver);
    }
    await dispatchAlerts(alerts, undefined, { match, statistics });
    log.info({ alerts: alerts.length }, "match strategy completed");
    return { statistics, alerts, error: null };
  } catch (exc) {
    const error = exc instanceof Error ? exc.message : String(exc);
    log.error({ err: exc }, "match strategy failed");
    return { statistics: null, alerts: [], error };
  }
};

const toMatch = (
  fixture: NonNullable<Awaited<ReturnType<typeof listLiveFixtures>>>[number],
  direttaMatchId: string,
): Match => {
  const stageId = API_FOOTBALL_STAGE[fixture.fixture.status.short ?? ""] ?? null;
  const stageStart = stageId !== null
    ? Math.floor(new Date(fixture.fixture.date).getTime() / 1000)
    : null;
  return {
    id: direttaMatchId,
    sport: 1,
    tournament: fixture.league.name,
    country: fixture.league.country,
    tournament_id: "",
    home: fixture.teams.home.name,
    away: fixture.teams.away.name,
    home_score: fixture.goals.home ?? null,
    away_score: fixture.goals.away ?? null,
    status: fixture.fixture.status.short ?? "",
    status_code: null,
    stage_id: stageId,
    stage_start: stageStart,
    is_live: true,
    minute: fixture.fixture.status.elapsed == null ? null : String(fixture.fixture.status.elapsed),
  };
};

const execute = async (
  context: StrategyContext,
  hooks: LiveMatchesStrategyHooks,
): Promise<StrategyResult> => {
  const log = getStrategyLogger();
  const liveFixtures = await listLiveFixtures();
  log.info({ fixtures: liveFixtures.length }, "live fixtures fetched from API-Football");

  const leagueLinks = await listLeagueLinks();
  const monitoredLeagueIds = new Set(
    leagueLinks
      .filter((link) => link.direttaTournamentId !== null && link.direttaTournamentId !== "")
      .map((link) => link.apiFootballLeagueId),
  );
  log.info({ monitoredLeagues: monitoredLeagueIds.size }, "monitored leagues from league_links");

  const results: StrategyMatchResult[] = [];
  for (const fixture of liveFixtures) {
    const leagueId = fixture.league.id;
    if (!monitoredLeagueIds.has(leagueId)) continue;

    const fixtureId = fixture.fixture.id;
    const scheduled = await getScheduledFixture(fixtureId);
    if (!scheduled?.match_id) {
      log.warn({ fixtureId, leagueId }, "no diretta link for live fixture");
      continue;
    }

    const apiFootballFixtureId = fixture.fixture.id;
    const match = toMatch(fixture, scheduled.match_id);
    const base = { matchId: match.id, home: match.home ?? "", away: match.away ?? "" };
    const matchContext = {
      strategy: LIVE_MATCHES_STRATEGY,
      match: `${base.home} - ${base.away}`,
      fixtureId: match.id,
    };
    const oddsResolver = (alert: Alert) => resolveApiFootballOdds(apiFootballFixtureId, alert.oddsMarket);
    const outcome = await runWithNewLogTrace(matchContext, () => runMatch(match, oddsResolver, hooks));
    results.push({ ...base, ...outcome });
  }

  const failures = results.filter((result) => result.error !== null).length;
  const result: StrategyResult = {
    name: LIVE_MATCHES_STRATEGY,
    matches: results.length,
    enriched: results.length - failures,
    failures,
    results,
  };
  log.info(
    { matches: result.matches, enriched: result.enriched, failures: result.failures },
    "live strategy completed",
  );
  return result;
};

export const runLiveMatchesStrategy = async (
  context: StrategyContext = {},
  hooks: LiveMatchesStrategyHooks = defaultHooks(),
): Promise<StrategyResult> => {
  return runWithLogContext({ strategy: LIVE_MATCHES_STRATEGY }, () => execute(context, hooks));
};

export const liveMatchesStrategy: Strategy = {
  name: LIVE_MATCHES_STRATEGY,
  run: (context: StrategyContext = {}) => runLiveMatchesStrategy(context),
};
