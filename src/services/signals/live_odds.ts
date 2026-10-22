import { client } from "../../scraper/client/index.ts";
import type { LiveOddsOffer } from "../../scraper/client/odds.ts";
import type { Alert } from "./alert.ts";
import { GOAL_OVER_HT_TEXT, GOAL_OVER_SIGNAL } from "./goal_over_signal.ts";

export const LIVE_ODDS_ENABLED_ENV = "MONITOR_SIGNAL_LIVE_ODDS";
export const LIVE_ODDS_BOOKMAKERS_ENV = "MONITOR_SIGNAL_LIVE_ODDS_BOOKMAKERS";
export const GOAL_OVER_HANDICAP = "0.5";
export const HT_ODDS_MARKET = "Over 0.5 HT";
export const FT_ODDS_MARKET = "Over 0.5 FT";

export interface PickedLiveOdds {
  odds: number;
  bookmaker: string;
  bookmakerId: number;
  market: string;
}

export type LiveOddsFetcher = (
  matchId: string,
  betType: string,
  betScope: string,
) => Promise<LiveOddsOffer[]>;

export const liveOddsEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => {
  const raw = env[LIVE_ODDS_ENABLED_ENV]?.trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export const configuredBookmakers = (env: NodeJS.ProcessEnv = process.env): number[] | undefined => {
  const raw = env[LIVE_ODDS_BOOKMAKERS_ENV]?.trim();
  if (!raw) {
    return undefined;
  }
  const ids = raw.split(",").flatMap((part) => {
    const id = Number.parseInt(part.trim(), 10);
    return Number.isInteger(id) && id > 0 ? [id] : [];
  });
  return ids.length > 0 ? ids : undefined;
}

export const pickBestOver = (
  offers: readonly LiveOddsOffer[],
  market: string,
  handicap = GOAL_OVER_HANDICAP,
): PickedLiveOdds | null => {
  let best: PickedLiveOdds | null = null;
  for (const offer of offers) {
    for (const line of offer.lines) {
      if (line.handicap !== handicap || line.over === null || !line.over.active) {
        continue;
      }
      const candidate: PickedLiveOdds = {
        odds: line.over.value,
        bookmaker: offer.bookmaker,
        bookmakerId: offer.bookmakerId,
        market,
      };
      if (best === null || candidate.odds > best.odds) {
        best = candidate;
      }
    }
  }
  return best;
}

const defaultFetcher: LiveOddsFetcher = (matchId, betType, betScope) => {
  return client.getLiveOddsOffers(matchId, betType, betScope, {
    bookmakerIds: configuredBookmakers(),
  });
}

const scopeAndMarket = (alert: Alert): { scope: string; market: string } => {
  if (alert.text === GOAL_OVER_HT_TEXT) {
    return { scope: "FIRST_HALF", market: HT_ODDS_MARKET };
  }
  return { scope: "FULL_TIME", market: FT_ODDS_MARKET };
}

export const attachLiveOdds = async (
  alerts: readonly Alert[],
  fetcher: LiveOddsFetcher = defaultFetcher,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  if (!liveOddsEnabled(env) || alerts.length === 0) {
    return;
  }
  for (const alert of alerts) {
    if (alert.rule !== GOAL_OVER_SIGNAL || typeof alert.odds === "number") {
      continue;
    }
    try {
      const primary = scopeAndMarket(alert);
      let picked = pickBestOver(await fetcher(alert.matchId, "OVER_UNDER", primary.scope), primary.market);
      if (picked === null && primary.scope !== "FULL_TIME") {
        picked = pickBestOver(
          await fetcher(alert.matchId, "OVER_UNDER", "FULL_TIME"),
          FT_ODDS_MARKET,
        );
      }
      if (picked !== null) {
        alert.odds = picked.odds;
        alert.oddsBookmaker = picked.bookmaker;
        alert.oddsMarket = picked.market;
      }
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : String(exc);
      console.error(`[signals] live odds failed for ${alert.matchId} (${alert.rule}): ${message}`);
    }
  }
}
