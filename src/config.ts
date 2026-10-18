export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface Settings {
  appName: string;
  appVersion: string;
  upstreamBaseUrl: string;
  logLevel: LogLevel;
  host: string;
  port: number;
  gcpProjectId: string;
  gcpRegion: string;
  gcpJobId: string;
  monitorJobTargetBaseUrl: string;
  schedulerTimeZone: string;
  monitorLeadMinutes: number;
  schedulerCronStepMinutes: number;
}

const DEFAULT_UPSTREAM = "https://bet-service-658489904938.europe-west6.run.app";

const asLogLevel = (value: string | undefined): LogLevel => {
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

export const getSettings = (env: NodeJS.ProcessEnv = process.env): Settings => {
  const lead = Number.parseInt(env.MONITOR_LEAD_MINUTES ?? "0", 10);
  const step = Number.parseInt(env.SCHEDULER_CRON_STEP_MINUTES ?? "10", 10);
  return {
    appName: env.APP_NAME ?? "SBI Backend APIs",
    appVersion: env.APP_VERSION ?? "0.1.5",
    upstreamBaseUrl: env.UPSTREAM_BASE_URL ?? DEFAULT_UPSTREAM,
    logLevel: asLogLevel(env.LOG_LEVEL),
    host: env.HOST ?? "127.0.0.1",
    port: Number.parseInt(env.PORT ?? "8000", 10),
    gcpProjectId: env.GCP_PROJECT_ID ?? "",
    gcpRegion: env.GCP_REGION ?? "europe-west6",
    gcpJobId: env.GCP_JOB_ID ?? "bet-monitoring-matches-scheduler",
    monitorJobTargetBaseUrl: env.MONITOR_JOB_TARGET_BASE_URL ?? "",
    schedulerTimeZone: env.SCHEDULER_TIME_ZONE ?? "Europe/Rome",
    monitorLeadMinutes: Number.isNaN(lead) || lead < 0 ? 0 : lead,
    schedulerCronStepMinutes: Number.isNaN(step) || step < 1 || step > 59 ? 10 : step,
  };
}
