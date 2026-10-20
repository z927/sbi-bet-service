import type { Match, Statistics } from "../../scraper/models.ts";
import type { Signal } from "./signal.ts";
import type { Alert } from "./alert.ts";
import { matchMinute, matchPeriod, type MatchPeriod } from "./match_minutes.ts";
import { touchSnapshot } from "./touch_ratio_signal.ts";

export const GOAL_OVER_SIGNAL = "goal-over-0.5";
export const GOAL_OVER_HT_TEXT = "Alert Goal Over 0.5 HT";
export const GOAL_OVER_FT_TEXT = "Alert Goal Over 0.5 FT";

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
    const snapshot = touchSnapshot(match, statistics);
    return {
      rule: GOAL_OVER_SIGNAL,
      matchId: match.id,
      home: match.home ?? "",
      away: match.away ?? "",
      minute,
      value: snapshot?.ratio ?? null,
      threshold: 0.5,
      text: period === "first_half" ? GOAL_OVER_HT_TEXT : GOAL_OVER_FT_TEXT,
      tournament: match.tournament ?? "",
      country: match.country ?? "",
      homeScore: match.home_score,
      awayScore: match.away_score,
      touches: snapshot?.touches ?? null,
    };
  },
};
