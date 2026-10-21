import type { Match, Statistics } from "../../scraper/models.ts";
import type { Signal } from "./signal.ts";
import type { Alert } from "./alert.ts";
import { matchMinute, matchPeriod, type MatchPeriod } from "./match_minutes.ts";
import { touchSnapshot } from "./touch_stats.ts";

export const GOAL_OVER_SIGNAL = "goal-over-0.5";
export const GOAL_OVER_HT_TEXT = "Alert Goal Over 0.5 HT";
export const GOAL_OVER_FT_TEXT = "Alert Goal Over 0.5 FT";
export const GOAL_RATIO_ENV = "MONITOR_SIGNAL_GOAL_RATIO_THRESHOLD";
export const DEFAULT_GOAL_RATIO_THRESHOLD = 0.7;

export const FIRST_HALF_WINDOW = { min: 10, max: 30 } as const;
export const SECOND_HALF_WINDOW = { min: 50, max: 70 } as const;

export interface MinuteWindow {
  readonly min: number;
  readonly max: number;
}

const WINDOWS: Record<MatchPeriod, MinuteWindow> = {
  first_half: FIRST_HALF_WINDOW,
  second_half: SECOND_HALF_WINDOW,
};

const getGoalRatioThreshold = (env: NodeJS.ProcessEnv = process.env): number => {
  const raw = env[GOAL_RATIO_ENV];
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_GOAL_RATIO_THRESHOLD;
  }
  const parsed = Number.parseFloat(raw);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return DEFAULT_GOAL_RATIO_THRESHOLD;
}

const inWindow = (minute: number, window: MinuteWindow): boolean => {
  return minute >= window.min && minute <= window.max;
};

export const goalOverSignal: Signal = {
  name: GOAL_OVER_SIGNAL,
  evaluate(match: Match, statistics: Statistics): Alert | null {
    const period = matchPeriod(match);
    if (period === null) {
      return null;
    }
    const minute = matchMinute(match);
    if (minute === null || !inWindow(minute, WINDOWS[period])) {
      return null;
    }
    const snapshot = touchSnapshot(match, statistics, period);
    if (snapshot === null) {
      return null;
    }
    const threshold = getGoalRatioThreshold();
    if (snapshot.ratio < threshold) {
      return null;
    }
    return {
      rule: GOAL_OVER_SIGNAL,
      matchId: match.id,
      home: match.home ?? "",
      away: match.away ?? "",
      minute,
      value: snapshot.ratio,
      threshold,
      text: period === "first_half" ? GOAL_OVER_HT_TEXT : GOAL_OVER_FT_TEXT,
      tournament: match.tournament ?? "",
      country: match.country ?? "",
      homeScore: match.home_score,
      awayScore: match.away_score,
      touches: snapshot.touches,
    };
  },
};
