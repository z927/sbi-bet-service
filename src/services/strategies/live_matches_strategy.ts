import { client } from "../../scraper/client/index.ts";
import type { Match, Statistics } from "../../scraper/models.ts";
import { getStrategyLogger, runWithLogContext, runWithNewLogTrace } from "../../logger.ts";
import {
  attachLiveOdds,
  dispatchAlerts,
  evaluateSignalsWithPreAlert,
  matchMinute,
  matchPeriod,
  touchSnapshot,
  type Alert,
} from "../signals/index.ts";
import { configuredMajorLeagues, isMajorLeague } from "./major_leagues.ts";
import { teamKey } from "../team_names.ts";
import { loadTeamMapping, findMappingByApi } from "../team_mapping.ts";
import { listLiveFixtures, listTodayFixtures } from "../api_football.ts";
import type {
  Strategy,
  StrategyContext,
  StrategyMatchResult,
  StrategyResult,
} from "./strategy.ts";

export const LIVE_MATCHES_STRATEGY = "live-matches-statistics";

export interface LiveMatchesStrategyHooks {
  allowlist: string[];
  log: (match: Match, statistics: Statistics) => void;
}

const defaultHooks = (): LiveMatchesStrategyHooks => ({
  allowlist: configuredMajorLeagues(),
  log: (match: Match, statistics: Statistics) => {
    getStrategyLogger().info(
      { matchId: match.id, home: match.home, away: match.away, statistics },
      `${match.home} - ${match.away}`,
    );
  },
});

const isLive = (match: Match): boolean => {
  return match.is_live === true;
}

interface MatchOutcome {
  statistics: Statistics | null;
  alerts: Alert[];
  error: string | null;
}

const logMatchProgress = (match: Match, statistics: Statistics): void => {
  const log = getStrategyLogger();
  const period = matchPeriod(match);
  const minute = matchMinute(match);
  if (minute !== null) {
    log.info({ minute, period }, "match minute");
  }
  if (period === null) {
    return;
  }
  const snapshot = touchSnapshot(match, statistics, period);
  if (snapshot === null) {
    return;
  }
  log.info(
    { minute, period, touches: snapshot.touches, ratio: Number(snapshot.ratio.toFixed(2)) },
    "touch ratio",
  );
};

const runMatch = async (
  match: Match,
  hooks: LiveMatchesStrategyHooks,
): Promise<MatchOutcome> => {
  const log = getStrategyLogger();
  log.info({ matchId: match.id }, "match strategy started");
  try {
    const statistics = await client.getStatistics(match.id);
    hooks.log(match, statistics);
    logMatchProgress(match, statistics);
    const alerts = await evaluateSignalsWithPreAlert(match, statistics, undefined, { match, statistics });
    if (alerts.length > 0) {
      await attachLiveOdds(alerts);
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

const execute = async (
  context: StrategyContext,
  hooks: LiveMatchesStrategyHooks,
): Promise<StrategyResult> => {
  const log = getStrategyLogger();
  const sport = context.sport ?? 1;
  const today = new Date().toISOString().slice(0, 10);
  const afFixtures = [...(await listTodayFixtures(today)), ...(await listLiveFixtures())];
  const mapping = loadTeamMapping();
  const afKeys = new Set(
    afFixtures.map((f) => {
      const m = findMappingByApi(mapping, f.teams.home.name, f.teams.home.id);
      const home = m?.direttaName ?? f.teams.home.name;
      const m2 = findMappingByApi(mapping, f.teams.away.name, f.teams.away.id);
      const away = m2?.direttaName ?? f.teams.away.name;
      return teamKey(home, away);
    }),
  );
  const allMatches = await client.listMatches(sport);
  const liveMatches = allMatches.filter((match) => {
    if (!isLive(match) || !isMajorLeague(match, hooks.allowlist)) return false;
    const key = teamKey(match.home, match.away);
    return afKeys.size === 0 || afKeys.has(key);
  });
  log.info({ sport, matches: liveMatches.length }, "live strategy started");

  const results: StrategyMatchResult[] = [];
  for (const match of liveMatches) {
    const base = { matchId: match.id, home: match.home ?? "", away: match.away ?? "" };
    const matchContext = {
      strategy: LIVE_MATCHES_STRATEGY,
      match: `${base.home} - ${base.away}`,
      fixtureId: match.id,
    };
    const outcome = await runWithNewLogTrace(matchContext, () => runMatch(match, hooks));
    results.push({ ...base, ...outcome });
  }

  const failures = results.filter((result) => result.error !== null).length;
  const result: StrategyResult = {
    name: LIVE_MATCHES_STRATEGY,
    matches: liveMatches.length,
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
