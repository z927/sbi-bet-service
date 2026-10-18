import { inspect } from "node:util";

import { client } from "../../scraper/client/index.ts";
import type { Match, Statistics } from "../../scraper/models.ts";
import { dispatchAlerts, evaluateSignals } from "../signals/index.ts";
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
    console.log(
      `[${LIVE_MATCHES_STRATEGY}] ${match.home} - ${match.away} (${match.id})`,
      inspect(statistics, { depth: null, breakLength: 120 }),
    );
  },
});

const isLive = (match: Match): boolean => {
  return match.is_live === true;
}

export const runLiveMatchesStrategy = async (
  context: StrategyContext = {},
  hooks: LiveMatchesStrategyHooks = defaultHooks(),
): Promise<StrategyResult> => {
  const sport = context.sport ?? 1;
  const liveMatches = (await client.listMatches(sport)).filter(
    (match) => isLive(match) && isMajorLeague(match, hooks.allowlist),
  );

  const results: StrategyMatchResult[] = [];
  for (const match of liveMatches) {
    const base = { matchId: match.id, home: match.home ?? "", away: match.away ?? "" };

    try {
      const statistics = await client.getStatistics(match.id);
      hooks.log(match, statistics);
      const alerts = evaluateSignals(match, statistics);
      await dispatchAlerts(alerts);
      results.push({ ...base, statistics, alerts, error: null });
    } catch (exc) {
      const error = exc instanceof Error ? exc.message : String(exc);
      results.push({ ...base, statistics: null, alerts: [], error });
    }
  }

  const failures = results.filter((result) => result.error !== null).length;
  return {
    name: LIVE_MATCHES_STRATEGY,
    matches: liveMatches.length,
    enriched: results.length - failures,
    failures,
    results,
  };
}

export const liveMatchesStrategy: Strategy = {
  name: LIVE_MATCHES_STRATEGY,
  run: (context: StrategyContext = {}) => runLiveMatchesStrategy(context),
};
