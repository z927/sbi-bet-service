import type { Alert } from "../../models/alert.ts";

export interface TelegramConfig {
  token: string;
  chatId: string;
}

export const TELEGRAM_BOT_TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
export const TELEGRAM_CHAT_ID_ENV = "TELEGRAM_CHAT_ID";
export const WIN_RATE_ENV = "MONITOR_SIGNAL_WIN_RATE";
export const DEFAULT_WIN_RATE = 80;

const TELEGRAM_API = "https://api.telegram.org";

export let lastTelegramMessage: string | null = null;

const COUNTRY_CODES: Record<string, string> = {
  africa: "",
  albania: "AL",
  "arabia saudita": "SA",
  argentina: "AR",
  armenia: "AM",
  australia: "AU",
  austria: "AT",
  azerbaigian: "AZ",
  azerbaijan: "AZ",
  bahrain: "BH",
  bangladesh: "BD",
  belgio: "BE",
  bolivia: "BO",
  "bosnia & herzegovina": "BA",
  brasile: "BR",
  bulgaria: "BG",
  "burkina faso": "BF",
  burundi: "BI",
  cile: "CL",
  cipro: "CY",
  congo: "CG",
  "congo dr": "CD",
  croazia: "HR",
  danimarca: "DK",
  ecuador: "EC",
  egitto: "EG",
  "emirati arabi": "AE",
  estonia: "EE",
  eswatini: "SZ",
  etiopia: "ET",
  europa: "EU",
  francia: "FR",
  galles: "GB",
  georgia: "GE",
  germania: "DE",
  giamaica: "JM",
  gibilterra: "GI",
  giordania: "JO",
  india: "IN",
  inghilterra: "GB",
  iran: "IR",
  iraq: "IQ",
  "irlanda del nord": "GB",
  israele: "IL",
  italia: "IT",
  kosovo: "XK",
  libano: "LB",
  libia: "LY",
  "macedonia del nord": "MK",
  malesia: "MY",
  mali: "ML",
  malta: "MT",
  marocco: "MA",
  mauritius: "MU",
  messico: "MX",
  moldavia: "MD",
  mondo: "",
  montenegro: "ME",
  nicaragua: "NI",
  niger: "NE",
  nigeria: "NG",
  olanda: "NL",
  oman: "OM",
  paraguay: "PY",
  polonia: "PL",
  portogallo: "PT",
  qatar: "QA",
  "repubblica ceca": "CZ",
  romania: "RO",
  ruanda: "RW",
  russia: "RU",
  scozia: "GB",
  serbia: "RS",
  seychelles: "SC",
  "sierra leone": "SL",
  singapore: "SG",
  slovenia: "SI",
  siria: "SY",
  spagna: "ES",
  "sri lanka": "LK",
  sudafrica: "ZA",
  suriname: "SR",
  svizzera: "CH",
  tagikistan: "TJ",
  tanzania: "TZ",
  thailandia: "TH",
  turchia: "TR",
  ucraina: "UA",
  ungheria: "HU",
  uruguay: "UY",
  uzbekistan: "UZ",
  vietnam: "VN",
  grecia: "GR",
  svezia: "SE",
  norvegia: "NO",
  irlanda: "IE",
  "stati uniti": "US",
};

const SUBDIVISION_FLAGS: Record<string, string> = {
  inghilterra: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  scozia: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  galles: "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
};

export const countryCode = (country: string | undefined): string | undefined => {
  if (!country) {
    return undefined;
  }
  return COUNTRY_CODES[country.trim().toLowerCase()] ?? undefined;
}

export const countryFlag = (country: string | undefined): string => {
  if (!country) {
    return "";
  }
  const key = country.trim().toLowerCase();
  const subdivision = SUBDIVISION_FLAGS[key];
  if (subdivision !== undefined) {
    return subdivision;
  }
  const code = COUNTRY_CODES[key];
  if (!code) {
    return "";
  }
  return flagFromCode(code);
}

const flagFromCode = (code: string): string => {
  return code
    .toUpperCase()
    .split("")
    .map((ch) => String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65))
    .join("");
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

export const stripCountryPrefix = (tournament: string, country: string | undefined): string => {
  const trimmed = tournament.trim();
  const separator = trimmed.indexOf(":");
  if (separator <= 0) {
    return trimmed;
  }
  const prefix = trimmed.slice(0, separator).trim();
  const countryKey = country?.trim().toLowerCase() ?? "";
  if (!prefix || !countryKey || prefix.toLowerCase() !== countryKey) {
    return trimmed;
  }
  return trimmed.slice(separator + 1).trim();
}

const formatAlert = (alert: Alert): string => {
  const minute = alert.minute === null ? "n/a" : `${alert.minute}°`;
  const flag = countryFlag(alert.country);
  const tournament = stripCountryPrefix(alert.tournament ?? "", alert.country);
  const league = [tournament, flag].filter((part) => part).join(" ");
  const touches = alert.touches === null || alert.touches === undefined ? "n/a" : String(alert.touches);
  const ratio = alert.value === null ? "n/a" : alert.value.toFixed(2);
  const odds = alert.odds === null || alert.odds === undefined ? "n/a" : alert.odds.toFixed(2);
  return [
    `⚽ ${alert.text}`,
    `🏆 ${league}`,
    `💹 Live, Win Rate: ➡️ ${getWinRate()}%`,
    `💶 Quota live: ${odds}`,
    `⏱ ${minute}`,
    `🎽 ${alert.home} vs ${alert.away}${formatScore(alert)}`,
    `ℹ️ Tocchi area: ${touches}`,
    `ℹ️ Rapporto: ${ratio}`,
  ].join("\n");
}

const formatPreAlert = (alert: Alert): string => {
  const minute = alert.minute === null ? "n/a" : `${alert.minute}°`;
  const flag = countryFlag(alert.country);
  const tournament = stripCountryPrefix(alert.tournament ?? "", alert.country);
  const league = [tournament, flag].filter((part) => part).join(" ");
  const touches = alert.touches === null || alert.touches === undefined ? "n/a" : String(alert.touches);
  const ratio = alert.value === null ? "n/a" : alert.value.toFixed(2);
  const odds = alert.odds === null || alert.odds === undefined ? "n/a" : alert.odds.toFixed(2);
  return [
    `👀 PRE-ALERT - Partita da monitorare`,
    `⚽ ${alert.text.replace("Alert Goal Over 0.5", "Goal Over 0.5 (potenziale)")}`,
    `🏆 ${league}`,
    `💹 Live, Win Rate: ➡️ ${getWinRate()}%`,
    `💶 Quota live: ${odds}`,
    `⏱ ${minute}`,
    `🎽 ${alert.home} vs ${alert.away}${formatScore(alert)}`,
    `ℹ️ Tocchi area: ${touches}`,
    `ℹ️ Rapporto: ${ratio}`,
    `⏳ Verrà ricontrollata tra ~5 min se rimane 0-0`,
  ].join("\n");
}

export const sendTelegram = async (
  alert: Alert,
  config: TelegramConfig | null = getTelegramConfig(),
): Promise<boolean> => {
  if (config === null) {
    return false;
  }
  const telegramText = formatAlert(alert);
  lastTelegramMessage = telegramText;
  const body = JSON.stringify({
    chat_id: config.chatId,
    text: telegramText,
  });
  const response = await fetch(`${TELEGRAM_API}/bot${config.token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!response.ok) {
    const responseText = (await response.text()).slice(0, 120);
    throw new Error(`Telegram HTTP ${response.status}: ${responseText}`);
  }
  return true;
}

export const sendPreAlertTelegram = async (
  alert: Alert,
  config: TelegramConfig | null = getTelegramConfig(),
): Promise<boolean> => {
  if (config === null) {
    return false;
  }
  const telegramText = formatPreAlert(alert);
  lastTelegramMessage = telegramText;
  const body = JSON.stringify({
    chat_id: config.chatId,
    text: telegramText,
  });
  const response = await fetch(`${TELEGRAM_API}/bot${config.token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!response.ok) {
    const responseText = (await response.text()).slice(0, 120);
    throw new Error(`Telegram HTTP ${response.status}: ${responseText}`);
  }
  return true;
}
