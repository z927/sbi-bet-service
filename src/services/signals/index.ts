import type { Match, Statistics } from "../../scraper/models.ts";
import type { Alert } from "./alert.ts";
import type { Signal } from "./signal.ts";
import { goalOverSignal, GOAL_OVER_SIGNAL, GOAL_RATIO_ENV, DEFAULT_GOAL_RATIO_THRESHOLD, FIRST_HALF_WINDOW, SECOND_HALF_WINDOW } from "./goal_over_signal.ts";
import { matchMinute, matchPeriod } from "./match_minutes.ts";
import { sendTelegram, sendPreAlertTelegram } from "./telegram.ts";
import { saveSignal } from "./repo.ts";
import { touchSnapshot } from "./touch_stats.ts";

export const SIGNALS: readonly Signal[] = [goalOverSignal];

const fired = new Set<string>();
const preAlerted = new Set<string>();
const preAlertCheckAt = new Map<string, number>();
const preAlertData = new Map<string, { match: Match; statistics: Statistics; alert: Alert; minute: number | null }>();

export const PRE_ALERT_MINUTE = 10;
export const PRE_ALERT_RATIO_FACTOR = 0.8;
export const PRE_ALERT_RECHECK_MINUTES = 5;

export const isZeroZero = (match: Match): boolean => {
  return match.home_score === 0 && match.away_score === 0;
}

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

const inWindow = (minute: number, min: number, max: number): boolean => {
  return minute >= min && minute <= max;
};

const maybeSendPreAlert = async (
  match: Match,
  statistics: Statistics,
): Promise<void> => {
  if (!isZeroZero(match)) {
    return;
  }
  const period = matchPeriod(match);
  if (period === null) {
    return;
  }
  const minute = matchMinute(match);
  if (minute === null) {
    return;
  }
  const key = `${match.id}:${GOAL_OVER_SIGNAL}`;
  if (fired.has(key) || preAlerted.has(key)) {
    return;
  }
  const window = period === "first_half" ? FIRST_HALF_WINDOW : SECOND_HALF_WINDOW;
  if (minute >= window.min) {
    return;
  }
  if (minute < PRE_ALERT_MINUTE) {
    return;
  }
  const snapshot = touchSnapshot(match, statistics, period);
  if (snapshot === null) {
    return;
  }
  const threshold = getGoalRatioThreshold();
  if (snapshot.ratio < threshold) {
    return;
  }
  const alert: Alert = {
    rule: GOAL_OVER_SIGNAL,
    matchId: match.id,
    home: match.home ?? "",
    away: match.away ?? "",
    minute,
    value: snapshot.ratio,
    threshold,
    text: period === "first_half" ? "Alert Goal Over 0.5 HT" : "Alert Goal Over 0.5 FT",
    tournament: match.tournament ?? "",
    country: match.country ?? "",
    homeScore: match.home_score,
    awayScore: match.away_score,
    touches: snapshot.touches,
    oddsMarket: {
      betType: "OVER_UNDER",
      handicap: 0.5,
      selection: "OVER",
      scope: period === "first_half" ? "FIRST_HALF" : "FULL_TIME",
    },
  };
  try {
    await sendPreAlertTelegram(alert);
  } catch (exc) {
    const error = exc instanceof Error ? exc.message : String(exc);
    console.error(`[signals] pre-alert dispatch failed for ${alert.matchId} (${alert.rule}): ${error}`);
  }
  preAlerted.add(key);
  preAlertCheckAt.set(key, Date.now() + PRE_ALERT_RECHECK_MINUTES * 60 * 1000);
  preAlertData.set(key, { match, statistics, alert, minute });
};

const recheckPreAlerts = async (
  currentMatch: Match,
  currentStatistics: Statistics,
  context?: { match?: Match; statistics?: Statistics },
): Promise<Alert[]> => {
  const key = `${currentMatch.id}:${GOAL_OVER_SIGNAL}`;
  if (fired.has(key)) {
    preAlerted.delete(key);
    preAlertCheckAt.delete(key);
    preAlertData.delete(key);
    return [];
  }
  if (!preAlerted.has(key)) {
    return [];
  }
  const checkAt = preAlertCheckAt.get(key);
  if (checkAt && Date.now() < checkAt) {
    return [];
  }
  preAlerted.delete(key);
  preAlertCheckAt.delete(key);
  const stored = preAlertData.get(key);
  preAlertData.delete(key);
  if (!stored) {
    return [];
  }
  if (!isZeroZero(currentMatch)) {
    return [];
  }
  const period = matchPeriod(currentMatch);
  if (period === null) {
    return [];
  }
  const minute = matchMinute(currentMatch);
  if (minute === null) {
    return [];
  }
  const window = period === "first_half" ? FIRST_HALF_WINDOW : SECOND_HALF_WINDOW;
  if (!inWindow(minute, window.min, window.max)) {
    return [];
  }
  const snapshot = touchSnapshot(currentMatch, currentStatistics, period);
  if (snapshot === null) {
    return [];
  }
  const threshold = getGoalRatioThreshold();
  if (snapshot.ratio < threshold) {
    return [];
  }
  const alert: Alert = {
    ...stored.alert,
    matchId: currentMatch.id,
    home: currentMatch.home ?? stored.alert.home,
    away: currentMatch.away ?? stored.alert.away,
    minute,
    value: snapshot.ratio,
    threshold,
    text: period === "first_half" ? "Alert Goal Over 0.5 HT" : "Alert Goal Over 0.5 FT",
    tournament: currentMatch.tournament ?? stored.alert.tournament,
    country: currentMatch.country ?? stored.alert.country,
    homeScore: currentMatch.home_score,
    awayScore: currentMatch.away_score,
    touches: snapshot.touches,
    oddsMarket: {
      betType: "OVER_UNDER",
      handicap: 0.5,
      selection: "OVER",
      scope: period === "first_half" ? "FIRST_HALF" : "FULL_TIME",
    },
  };
  fired.add(key);
  await dispatchAlerts([alert], sendTelegram, context ?? { match: currentMatch, statistics: currentStatistics });
  return [alert];
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

export const evaluateSignalsWithPreAlert = async (
  match: Match,
  statistics: Statistics,
  signals: readonly Signal[] = SIGNALS,
  context?: { match?: Match; statistics?: Statistics },
): Promise<Alert[]> => {
  if (!isZeroZero(match)) {
    const key = `${match.id}:${GOAL_OVER_SIGNAL}`;
    preAlerted.delete(key);
    preAlertCheckAt.delete(key);
    preAlertData.delete(key);
    return [];
  }
  const preAlerts = await recheckPreAlerts(match, statistics, context);
  if (preAlerts.length > 0) {
    return preAlerts;
  }
  await maybeSendPreAlert(match, statistics);
  return evaluateSignals(match, statistics, signals);
}

export const dispatchAlerts = async (
  alerts: readonly Alert[],
  sender: (alert: Alert) => Promise<boolean> = sendTelegram,
  context?: { match?: Match; statistics?: Statistics },
): Promise<void> => {
  for (const alert of alerts) {
    try {
      await sender(alert);
    } catch (exc) {
      const error = exc instanceof Error ? exc.message : String(exc);
      console.error(`[signals] dispatch failed for ${alert.rule} (match ${alert.matchId}): ${error}`);
    }
    try {
      await saveSignal(alert, context);
    } catch (exc) {
      const error = exc instanceof Error ? exc.message : String(exc);
      console.error(`[signals] failed to persist signal for ${alert.matchId} (${alert.rule}): ${error}`);
    }
  }
}

export const resetSignalState = (): void => {
  fired.clear();
  preAlerted.clear();
  preAlertCheckAt.clear();
  preAlertData.clear();
}

export {
  goalOverSignal,
  GOAL_OVER_SIGNAL,
  GOAL_OVER_HT_TEXT,
  GOAL_OVER_FT_TEXT,
  GOAL_OVER_MARKET,
  GOAL_RATIO_ENV,
  DEFAULT_GOAL_RATIO_THRESHOLD,
  FIRST_HALF_WINDOW,
  SECOND_HALF_WINDOW,
} from "./goal_over_signal.ts";
export { firstHalfMinutes, matchMinute, matchPeriod, secondHalfMinutes } from "./match_minutes.ts";
export type { MatchPeriod } from "./match_minutes.ts";
export { touchSnapshot, TOUCH_STAT_NAME, TOUCH_CATEGORY } from "./touch_stats.ts";
export type { TouchSnapshot } from "./touch_stats.ts";
export { getTelegramConfig, sendTelegram, sendPreAlertTelegram, countryFlag, getWinRate, stripCountryPrefix, TELEGRAM_BOT_TOKEN_ENV, TELEGRAM_CHAT_ID_ENV, WIN_RATE_ENV, DEFAULT_WIN_RATE } from "./telegram.ts";
export { attachLiveOdds, resolveLiveOdds, DEFAULT_ODDS_GEO } from "./live_odds.ts";
export type { AlertOddsResolver } from "./live_odds.ts";
export type { Alert } from "./alert.ts";
export type { Signal } from "./signal.ts";
export type { TelegramConfig } from "./telegram.ts";
