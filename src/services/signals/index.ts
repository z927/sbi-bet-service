import type { Match, Statistics } from "../../scraper/models.ts";
import type { Alert } from "./alert.ts";
import type { Signal } from "./signal.ts";
import { touchRatioSignal } from "./touch_ratio_signal.ts";
import { sendTelegram } from "./telegram.ts";

export const SIGNALS: readonly Signal[] = [touchRatioSignal];

const fired = new Set<string>();

export const evaluateSignals = (
  match: Match,
  statistics: Statistics,
  signals: readonly Signal[] = SIGNALS,
): Alert[] => {
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
export { firstHalfMinutes } from "./match_minutes.ts";
export { getTelegramConfig, sendTelegram, countryFlag, TELEGRAM_BOT_TOKEN_ENV, TELEGRAM_CHAT_ID_ENV } from "./telegram.ts";
export type { Alert } from "./alert.ts";
export type { Signal } from "./signal.ts";
export type { TelegramConfig } from "./telegram.ts";
