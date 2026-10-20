import type { Match, StatItem, Statistics } from "../../scraper/models.ts";
import type { Signal } from "./signal.ts";
import type { Alert } from "./alert.ts";
import { firstHalfMinutes, secondHalfMinutes, type MatchPeriod } from "./match_minutes.ts";

export const TOUCH_RATIO_SIGNAL = "touch-ratio-over-0.5-ht";
export const TOUCHES_ENV = "MONITOR_SIGNAL_TOUCHES_THRESHOLD";
export const DEFAULT_TOUCHES_THRESHOLD = 0.4;

export const TOUCH_STAT_NAME = "Palloni toccati nell'area avversaria";
export const TOUCH_PERIOD = "first_half";
export const TOUCH_CATEGORY = "attack";
const ALERT_TEXT = "Alert over 0.5 HT!";

export interface TouchSnapshot {
  touches: number;
  ratio: number;
}

const getThreshold = (env: NodeJS.ProcessEnv = process.env): number => {
  const raw = env[TOUCHES_ENV];
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_TOUCHES_THRESHOLD;
  }
  const parsed = Number.parseFloat(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_TOUCHES_THRESHOLD;
}

const findStatItem = (
  statistics: Statistics,
  period: string,
  category: string,
  name: string,
): StatItem | null => {
  const periodCategory = statistics[period]?.[category];
  if (!Array.isArray(periodCategory)) {
    return null;
  }
  return periodCategory.find((item) => item.name === name) ?? null;
}

export const touchSnapshot = (
  match: Match,
  statistics: Statistics,
  period: MatchPeriod = TOUCH_PERIOD,
): TouchSnapshot | null => {
  const item = findStatItem(statistics, period, TOUCH_CATEGORY, TOUCH_STAT_NAME);
  if (item === null) {
    return null;
  }
  const home = Number.parseInt(item.home, 10);
  const away = Number.parseInt(item.away, 10);
  if (Number.isNaN(home) || Number.isNaN(away)) {
    return null;
  }
  const minutes = period === "second_half" ? secondHalfMinutes(match) : firstHalfMinutes(match);
  if (minutes === null || minutes <= 0) {
    return null;
  }
  const touches = home + away;
  return { touches, ratio: touches / minutes };
}

export const touchRatioSignal: Signal = {
  name: TOUCH_RATIO_SIGNAL,
  evaluate(match: Match, statistics: Statistics): Alert | null {
    const snapshot = touchSnapshot(match, statistics);
    if (snapshot === null) {
      return null;
    }
    const threshold = getThreshold();
    if (snapshot.ratio < threshold) {
      return null;
    }
    return {
      rule: TOUCH_RATIO_SIGNAL,
      matchId: match.id,
      home: match.home ?? "",
      away: match.away ?? "",
      minute: firstHalfMinutes(match),
      value: snapshot.ratio,
      threshold,
      text: ALERT_TEXT,
      tournament: match.tournament ?? "",
      country: match.country ?? "",
      homeScore: match.home_score ?? null,
      awayScore: match.away_score ?? null,
      touches: snapshot.touches,
    };
  },
}
