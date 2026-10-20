import type { Match, Statistics } from "../../scraper/models.ts";
import type { Alert } from "./alert.ts";
import type { Signal } from "./signal.ts";
import { goalOverSignal } from "./goal_over_signal.ts";
import { touchRatioSignal } from "./touch_ratio_signal.ts";
import { sendTelegram } from "./telegram.ts";

export const SIGNALS: readonly Signal[] = [touchRatioSignal, goalOverSignal];

const fired = new Set<string>();

export const isZeroZero = (match: Match): boolean => {
  return match.home_score === 0 && match.away_score === 0;
}

export const evaluateSignals = (
  match: Match,
  statistics: Statistics,
  signals: readonly Signal[] = SIGNALS,
): Alert[] => {
  if (!isZeroZero(match)) {
    return [];
  }
  const alerts: Alert[] = [];
  for (const signal of signals) {
    const key = `${match.id}:${signal.name}`;
    if (fired.has(key)) {
      continue;
    }
    const alert = signal.evaluate(match, statistics);
    if (alert !== null) {
      fired.add(key);
      alerts.push(alert);
    }
  }
  return alerts;
}

export const dispatchAlerts = async (
  alerts: readonly Alert[],
  sender: (alert: Alert) => Promise<boolean> = sendTelegram,
): Promise<void> => {
  for (const alert of alerts) {
    try {
      await sender(alert);
    } catch (exc) {
      const error = exc instanceof Error ? exc.message : String(exc);
      console.error(`[signals] dispatch failed for ${alert.rule} (match ${alert.matchId}): ${error}`);
    }
  }
}

export const resetSignalState = (): void => {
  fired.clear();
}

export { touchRatioSignal, TOUCH_RATIO_SIGNAL, TOUCHES_ENV, DEFAULT_TOUCHES_THRESHOLD } from "./touch_ratio_signal.ts";
export {
  goalOverSignal,
  GOAL_OVER_SIGNAL,
  GOAL_OVER_HT_TEXT,
  GOAL_OVER_FT_TEXT,
  FIRST_HALF_WINDOW,
  SECOND_HALF_WINDOW,
} from "./goal_over_signal.ts";
export { firstHalfMinutes, matchMinute, matchPeriod } from "./match_minutes.ts";
export type { MatchPeriod } from "./match_minutes.ts";
export { getTelegramConfig, sendTelegram, countryFlag, getWinRate, TELEGRAM_BOT_TOKEN_ENV, TELEGRAM_CHAT_ID_ENV, WIN_RATE_ENV, DEFAULT_WIN_RATE } from "./telegram.ts";
export type { Alert } from "./alert.ts";
export type { Signal } from "./signal.ts";
export type { TelegramConfig } from "./telegram.ts";
