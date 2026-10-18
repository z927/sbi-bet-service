import type { Match, StatItem, Statistics } from "../../scraper/models.ts";
import type { Signal } from "./signal.ts";
import type { Alert } from "./alert.ts";
import { firstHalfMinutes } from "./match_minutes.ts";

export const TOUCH_RATIO_SIGNAL = "touch-ratio-over-0.5-ht";
export const TOUCHES_ENV = "MONITOR_SIGNAL_TOUCHES_THRESHOLD";
export const DEFAULT_TOUCHES_THRESHOLD = 0.4;

const STAT_NAME = "Palloni toccati nell'area avversaria";
const PERIOD = "first_half";
const CATEGORY = "attack";
const ALERT_TEXT = "Alert goal Over 0.5 HT";

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

export const touchRatioSignal: Signal = {
  name: TOUCH_RATIO_SIGNAL,
  evaluate(match: Match, statistics: Statistics): Alert | null {
    const item = findStatItem(statistics, PERIOD, CATEGORY, STAT_NAME);
    if (item === null) {
      return null;
    }
    const home = Number.parseInt(item.home, 10);
    const away = Number.parseInt(item.away, 10);
    if (Number.isNaN(home) || Number.isNaN(away)) {
      return null;
    }
    const minutes = firstHalfMinutes(match);
    if (minutes === null || minutes <= 0) {
      return null;
    }
    const total = home + away;
    const ratio = total / minutes;
    const threshold = getThreshold();
    if (ratio < threshold) {
      return null;
    }
    return {
      rule: TOUCH_RATIO_SIGNAL,
      matchId: match.id,
      home: match.home ?? "",
      away: match.away ?? "",
      minute: minutes,
      value: ratio,
      threshold,
      text: ALERT_TEXT,
    };
  },
}
