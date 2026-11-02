import { client } from "../../scraper/client/index.ts";
import type { Match, Statistics } from "../../scraper/models.ts";
import { getStrategyLogger, runWithLogContext } from "../../logger.ts";
import {
  attachLiveOdds,
  dispatchAlerts,
  evaluateSignalsWithPreAlert,
  type Alert,
} from "../signals/index.ts";
import { configuredMajorLeagues, isMajorLeague } from "./major_leagues.ts";
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

const runMatch = async (
  match: Match,
  hooks: LiveMatchesStrategyHooks,
): Promise<MatchOutcome> => {
  try {
    const statistics = await client.getStatistics(match.id);
    hooks.log(match, statistics);
    const alerts = await evaluateSignalsWithPreAlert(match, statistics, undefined, { match, statistics });
    if (alerts.length > 0) {
      await attachLiveOdds(alerts);
    }
    await dispatchAlerts(alerts, undefined, { match, statistics });
    return { statistics, alerts, error: null };
  } catch (exc) {
    const error = exc instanceof Error ? exc.message : String(exc);
    getStrategyLogger().error({ err: exc }, "strategy match failed");
    return { statistics: null, alerts: [], error };
  }
};

const execute = async (
  context: StrategyContext,
  hooks: LiveMatchesStrategyHooks,
): Promise<StrategyResult> => {
  const log = getStrategyLogger();
  const sport = context.sport ?? 1;
  const liveMatches = (await client.listMatches(sport)).filter(
    (match) => isLive(match) && isMajorLeague(match, hooks.allowlist),
  );
  log.info({ sport, matches: liveMatches.length }, "live strategy started");

  const results: StrategyMatchResult[] = [];
  for (const match of liveMatches) {
    const base = { matchId: match.id, home: match.home ?? "", away: match.away ?? "" };
    const matchContext = {
      strategy: LIVE_MATCHES_STRATEGY,
      match: `${base.home} - ${base.away}`,
      fixtureId: match.id,
    };
    const outcome = await runWithLogContext(matchContext, () => runMatch(match, hooks));
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
