import type { Match, StatItem, Statistics } from "../../scraper/models.ts";
import { firstHalfMinutes, secondHalfMinutes, type MatchPeriod } from "./match_minutes.ts";

export const TOUCH_STAT_NAME = "Palloni toccati nell'area avversaria";
export const TOUCH_CATEGORY = "attack";

export interface TouchSnapshot {
  touches: number;
  ratio: number;
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
};

const SECOND_HALF_OFFSET = 45;

const periodMinutes = (
  match: Match,
  period: MatchPeriod,
): number | null => {
  const minute = match.minute == null ? null : Number.parseInt(match.minute, 10);
  if (minute !== null && Number.isFinite(minute) && minute > 0) {
    return period === "second_half" ? Math.max(1, minute - SECOND_HALF_OFFSET) : minute;
  }
  return period === "second_half" ? secondHalfMinutes(match) : firstHalfMinutes(match);
};

export const touchSnapshot = (
  match: Match,
  statistics: Statistics,
  period: MatchPeriod,
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
  const minutes = periodMinutes(match, period);
  if (minutes === null || minutes <= 0) {
    return null;
  }
  const touches = home + away;
  return { touches, ratio: touches / minutes };
};
