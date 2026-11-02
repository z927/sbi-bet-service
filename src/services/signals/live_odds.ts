import { client } from "../../scraper/client/index.ts";
import { bestLiveOutcome } from "../../scraper/client/odds.ts";
import { getStrategyLogger } from "../../logger.ts";
import type { Alert } from "./alert.ts";

export const DEFAULT_ODDS_GEO = "IT";

export type AlertOddsResolver = (alert: Alert) => Promise<number | null>;

export const resolveLiveOdds = async (
  alert: Alert,
  geo = DEFAULT_ODDS_GEO,
): Promise<number | null> => {
  if (!alert.oddsMarket) {
    return null;
  }
  const odds = await client.getLiveOdds(alert.matchId, geo);
  return bestLiveOutcome(odds, alert.oddsMarket);
}

export const attachLiveOdds = async (
  alerts: readonly Alert[],
  resolver: AlertOddsResolver = resolveLiveOdds,
): Promise<void> => {
  for (const alert of alerts) {
    if (!alert.oddsMarket) {
      continue;
    }
    try {
      alert.odds = await resolver(alert);
    } catch (exc) {
      alert.odds = null;
      getStrategyLogger().error(
        { err: exc, rule: alert.rule, matchId: alert.matchId },
        "live odds lookup failed",
      );
    }
  }
}
