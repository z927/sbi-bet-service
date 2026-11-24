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
import { fetchAndSaveFulltimeOdds } from "../odds_service.ts";
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

const handicapFromValue = (value: string): number | null => {
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const captured = match[1];
  if (!captured) {
    return null;
  }
  return Number.parseFloat(captured);
};

const OVER_UNDER_LINE_FIRST_HALF_ID = 24;
const OVER_UNDER_LINE_FIRST_HALF_NAME = "Over/Under Line (1st Half)";
const OVER_UNDER_LINE_SECOND_HALF_ID = 25;
const OVER_UNDER_LINE_SECOND_HALF_NAME = "Match Goals";
const OVER_UNDER_LINE_FULL_TIME_ID = 36;
const OVER_UNDER_LINE_FULL_TIME_NAME = "Over/Under Line";

interface OddLookup {
  odd: number | null;
  betName: string | null;
}

const targetBetsForScope = (scope: string): Array<{ id: number; name: string }> => {
  if (scope === "FIRST_HALF") {
    return [{ id: OVER_UNDER_LINE_FIRST_HALF_ID, name: OVER_UNDER_LINE_FIRST_HALF_NAME }];
  }
  if (scope === "SECOND_HALF") {
    return [
      { id: OVER_UNDER_LINE_SECOND_HALF_ID, name: OVER_UNDER_LINE_SECOND_HALF_NAME },
      { id: OVER_UNDER_LINE_FULL_TIME_ID, name: OVER_UNDER_LINE_FULL_TIME_NAME },
    ];
  }
  if (scope === "FULL_TIME") {
    return [{ id: OVER_UNDER_LINE_FULL_TIME_ID, name: OVER_UNDER_LINE_FULL_TIME_NAME }];
  }
  return [];
};

const findOverUnderOdd = (
  bets: unknown[],
  handicap: number,
  scope: string,
): OddLookup => {
  const targets = targetBetsForScope(scope);
  if (targets.length === 0) {
    return { odd: null, betName: null };
  }
  const isTargetBet = (bet: unknown): { id: number; name: string } | null => {
    const betId = (bet as { id?: unknown }).id;
    const betName = String((bet as { name?: string }).name ?? "");
    for (const target of targets) {
      if (
        (betId !== undefined && betId !== null && Number(betId) === target.id) ||
        betName === target.name
      ) {
        return target;
      }
    }
    return null;
  };
  for (const bet of bets) {
    const target = isTargetBet(bet);
    if (!target) {
      continue;
    }
    const values = (bet as { values?: unknown[] }).values ?? [];
    for (const v of values) {
      const val = v as { value?: string; odd?: string | number; handicap?: unknown };
      if (val.value !== "Over") {
        continue;
      }
      const betHandicap = val.handicap;
      if (betHandicap !== undefined && betHandicap !== null) {
        if (String(betHandicap) !== String(handicap)) {
          continue;
        }
      } else {
        const h = handicapFromValue(String(val.value ?? ""));
        if (h === null || h !== handicap) {
          continue;
        }
      }
      const odd = Number(val.odd);
      if (!Number.isFinite(odd)) {
        continue;
      }
      return { odd, betName: target.name };
    }
  }
  return { odd: null, betName: null };
};

const resolveApiFootballOdds = async (
  fixtureId: number,
  oddsMarket: OddsMarketSelector | undefined,
): Promise<number | null> => {
  if (!oddsMarket || oddsMarket.betType !== "OVER_UNDER" || oddsMarket.selection !== "OVER") {
    return null;
  }
  const odds = await getLiveOdds(fixtureId);
  getStrategyLogger().info(
    { fixtureId, rawOdds: odds },
    "live odds raw payload [troubleshooting]",
  );
  const allBets = odds.flatMap((o) => o.odds ?? []);
  const { odd, betName } = findOverUnderOdd(allBets, oddsMarket.handicap, oddsMarket.scope);
  getStrategyLogger().info(
    {
      fixtureId,
      handicap: oddsMarket.handicap,
      scope: oddsMarket.scope,
      betName,
      odd,
    },
    "live odds resolved",
  );
  return odd;
};

const runMatch = async (
  match: Match,
  oddsResolver: (alert: Alert) => Promise<number | null>,
  hooks: LiveMatchesStrategyHooks,
  fixtureId: number,
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
    await dispatchAlerts(alerts, undefined, { match, statistics, fixtureId });
    if (period === "first_half" && fixtureId != null) {
      await fetchAndSaveFulltimeOdds(fixtureId, match.id);
    }
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
    const outcome = await runWithNewLogTrace(matchContext, () => runMatch(match, oddsResolver, hooks, apiFootballFixtureId));
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
