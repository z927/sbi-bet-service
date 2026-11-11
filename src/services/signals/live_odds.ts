import { getStrategyLogger } from "../../logger.ts";
import type { Alert } from "./alert.ts";

export type AlertOddsResolver = (alert: Alert) => Promise<number | null>;

export const attachLiveOdds = async (
  alerts: readonly Alert[],
  resolver: AlertOddsResolver,
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
