export interface TelegramConfig {
  token: string;
  chatId: string;
}

export const TELEGRAM_BOT_TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
export const TELEGRAM_CHAT_ID_ENV = "TELEGRAM_CHAT_ID";

const TELEGRAM_API = "https://api.telegram.org";

export const getTelegramConfig = (env: NodeJS.ProcessEnv = process.env): TelegramConfig | null => {
  const token = env[TELEGRAM_BOT_TOKEN_ENV]?.trim();
  const chatId = env[TELEGRAM_CHAT_ID_ENV]?.trim();
  if (!token || !chatId) {
    return null;
  }
  return { token, chatId };
}

const formatAlert = (alert: Alert): string => {
  const value = alert.value === null ? "n/a" : alert.value.toFixed(2);
  const minute = alert.minute === null ? "n/a" : `${alert.minute}'`;
  return `${alert.text}\n${alert.home} - ${alert.away} (${minute}) tocchi/min ${value} >= ${alert.threshold}`;
}

import type { Alert } from "./alert.ts";

export const sendTelegram = async (
  alert: Alert,
  config: TelegramConfig | null = getTelegramConfig(),
): Promise<boolean> => {
  if (config === null) {
    return false;
  }
  const body = JSON.stringify({
    chat_id: config.chatId,
    text: formatAlert(alert),
  });
  const response = await fetch(`${TELEGRAM_API}/bot${config.token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!response.ok) {
    const text = (await response.text()).slice(0, 120);
    throw new Error(`Telegram HTTP ${response.status}: ${text}`);
  }
  return true;
}
