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
  const minutes = period === "second_half" ? secondHalfMinutes(match) : firstHalfMinutes(match);
  if (minutes === null || minutes <= 0) {
    return null;
  }
  const touches = home + away;
  return { touches, ratio: touches / minutes };
};
