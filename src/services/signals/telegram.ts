import type { Alert } from "./alert.ts";

export interface TelegramConfig {
  token: string;
  chatId: string;
}

export const TELEGRAM_BOT_TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
export const TELEGRAM_CHAT_ID_ENV = "TELEGRAM_CHAT_ID";
export const WIN_RATE_ENV = "MONITOR_SIGNAL_WIN_RATE";
export const DEFAULT_WIN_RATE = 80;

const TELEGRAM_API = "https://api.telegram.org";

const COUNTRY_FLAGS: Record<string, string> = {
  italia: "🇮🇹",
  inghilterra: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  germania: "🇩🇪",
  austria: "🇦🇹",
  spagna: "🇪🇸",
  francia: "🇫🇷",
  olanda: "🇳🇱",
  portogallo: "🇵🇹",
  romania: "🇷🇴",
  serbia: "🇷🇸",
  danimarca: "🇩🇰",
  turchia: "🇹🇷",
  belgio: "🇧🇪",
  scozia: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  svizzera: "🇨🇭",
  grecia: "🇬🇷",
  croazia: "🇭🇷",
  polonia: "🇵🇱",
  ucraina: "🇺🇦",
  russia: "🇷🇺",
  svezia: "🇸🇪",
  norvegia: "🇳🇴",
  irlanda: "🇮🇪",
  europa: "🇪🇺",
  brasile: "🇧🇷",
  argentina: "🇦🇷",
  messico: "🇲🇽",
  "stati uniti": "🇺🇸",
};

export const countryFlag = (country: string | undefined): string => {
  if (!country) {
    return "";
  }
  return COUNTRY_FLAGS[country.trim().toLowerCase()] ?? "";
}

export const getTelegramConfig = (env: NodeJS.ProcessEnv = process.env): TelegramConfig | null => {
  const token = env[TELEGRAM_BOT_TOKEN_ENV]?.trim();
  const chatId = env[TELEGRAM_CHAT_ID_ENV]?.trim();
  if (!token || !chatId) {
    return null;
  }
  return { token, chatId };
}

export const getWinRate = (env: NodeJS.ProcessEnv = process.env): number => {
  const raw = env[WIN_RATE_ENV]?.trim();
  if (!raw) {
    return DEFAULT_WIN_RATE;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : DEFAULT_WIN_RATE;
}

const formatScore = (alert: Alert): string => {
  if (typeof alert.homeScore !== "number" || typeof alert.awayScore !== "number") {
    return "";
  }
  return ` [${alert.homeScore}-${alert.awayScore}]`;
}

const formatAlert = (alert: Alert): string => {
  const minute = alert.minute === null ? "n/a" : `${alert.minute}°`;
  const flag = countryFlag(alert.country);
  const league = [alert.tournament, flag].filter((part) => part).join(" ");
  const touches = alert.touches === null || alert.touches === undefined ? "n/a" : String(alert.touches);
  const ratio = alert.value === null ? "n/a" : alert.value.toFixed(2);
  return [
    `⚽ ${alert.text}`,
    `🏆 ${league}`,
    `💹 Live, Win Rate: ➡️ ${getWinRate()}%`,
    `⏱ ${minute}`,
    `🎽 ${alert.home} vs ${alert.away}${formatScore(alert)}`,
    `ℹ️ Tocchi area: ${touches}`,
    `ℹ️ Rapporto: ${ratio}`,
  ].join("\n");
}

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
