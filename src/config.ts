export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface Settings {
  appName: string;
  appVersion: string;
  upstreamBaseUrl: string;
  logLevel: LogLevel;
  host: string;
  port: number;
}

const DEFAULT_UPSTREAM = "https://bet-service-658489904938.europe-west6.run.app";

function asLogLevel(value: string | undefined): LogLevel {
  const normalized = (value ?? "info").toLowerCase();
  if (
    normalized === "debug" ||
    normalized === "info" ||
    normalized === "warn" ||
    normalized === "error" ||
    normalized === "silent"
  ) {
    return normalized;
  }
  return "info";
}

export function getSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    appName: env.APP_NAME ?? "SBI Backend APIs",
    appVersion: env.APP_VERSION ?? "0.1.5",
    upstreamBaseUrl: env.UPSTREAM_BASE_URL ?? DEFAULT_UPSTREAM,
    logLevel: asLogLevel(env.LOG_LEVEL),
    host: env.HOST ?? "127.0.0.1",
    port: Number.parseInt(env.PORT ?? "8000", 10),
  };
}
