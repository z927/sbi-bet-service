import { getSettings, type Settings } from "../config.ts";
import { ConflictError, baseResponse } from "../errors.ts";
import type { BaseResponse } from "../types.ts";
import { client as feedClient, FeedError } from "../scraper/client/index.ts";
import * as db from "../scraper/db.ts";
import type { Match } from "../scraper/models.ts";
import { defaultSchedulerClient, type SchedulerClient } from "../cloud_scheduler/client.ts";
import { configuredMajorLeagues, isMajorLeague } from "./strategies/major_leagues.ts";
import { buildCron, cronHitsDay } from "./cron.ts";

const SPORT_CALCIO = 1;
const FALLBACK_END_OFFSET_SECONDS = 2 * 60 * 60;
const DETAIL_WORKERS = 4;

const asEpoch = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

const pool = async <T>(items: readonly T[], workers: number, fn: (item: T) => Promise<void>): Promise<void> => {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(workers, queue.length) }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) {
        return;
      }
      await fn(item);
    }
  });
  await Promise.all(runners);
}

const schedulerEnabled = (settings: Settings): boolean => {
  return settings.gcpProjectId !== "" && settings.gcpJobId !== "" && settings.monitorJobTargetBaseUrl !== "";
}

const enrichWindows = async (matches: Match[], leadMinutes: number): Promise<void> => {
  await pool(matches, DETAIL_WORKERS, async (match) => {
    const start = asEpoch(match.start_time);
    if (start === null) {
      return;
    }
    let endTime: number | null = null;
    try {
      const detail = await feedClient.getMatch(match.id);
      match.detail = detail;
      endTime = asEpoch(detail["end_time"]);
    } catch (exc) {
      if (!(exc instanceof FeedError)) {
        throw exc;
      }
    }
    match["begin_monitoring_time"] = start - leadMinutes * 60;
    match["end_monitoring_time"] = endTime ?? start + FALLBACK_END_OFFSET_SECONDS;
    match["monitored"] = true;
  });
}

export const autoScheduleEvents = async (
  scheduler: SchedulerClient = defaultSchedulerClient(),
): Promise<BaseResponse> => {
  const settings = getSettings();
  const now = new Date();
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const allowlist = configuredMajorLeagues();

  const dayMatches = await feedClient.listMatches(SPORT_CALCIO);
  const upcoming = dayMatches.filter(
    (match) =>
      isMajorLeague(match, allowlist) &&
      asEpoch(match.start_time) !== null &&
      asEpoch(match.start_time)! >= nowEpoch,
  );

  if (upcoming.length === 0) {
    if (schedulerEnabled(settings)) {
      await scheduler.deleteJob(settings.gcpJobId);
    }
    return baseResponse("Auto-schedule completed: no upcoming major-league matches", 200);
  }

  await enrichWindows(upcoming, settings.monitorLeadMinutes);
  db.upsertMatches(upcoming);

  const windows = upcoming.map((match) => ({
    begin: asEpoch(match["begin_monitoring_time"]) ?? 0,
    end: asEpoch(match["end_monitoring_time"]) ?? 0,
  }));
  const cron = buildCron(windows, settings.schedulerTimeZone, now, settings.schedulerCronStepMinutes);
  if (cron === null) {
    return baseResponse(
      `Auto-schedule completed: ${upcoming.length} fixtures monitored, no future start times left to schedule`,
      200,
    );
  }

  if (!schedulerEnabled(settings)) {
    return baseResponse(
      `Auto-schedule completed: ${upcoming.length} fixtures monitored (Cloud Scheduler not configured, cron ${cron})`,
      200,
    );
  }

  const input = {
    schedule: cron,
    timeZone: settings.schedulerTimeZone,
    httpTarget: {
      httpMethod: "POST",
      uri: `${settings.monitorJobTargetBaseUrl.replace(/\/+$/, "")}/api/v1/monitor`,
      headers: { "Content-Type": "application/json" },
      body: Buffer.from("[]").toString("base64"),
    },
  };

  const existing = await scheduler.getJob(settings.gcpJobId);
  if (existing && cronHitsDay(existing.schedule, settings.schedulerTimeZone, now)) {
    throw new ConflictError(`Auto-schedule already executed for today (job ${settings.gcpJobId} fires today)`);
  }
  if (existing) {
    await scheduler.updateJob(settings.gcpJobId, input);
  } else {
    await scheduler.createJob(input);
  }
  return baseResponse(
    `Auto-schedule completed: ${upcoming.length} fixtures monitored, job ${settings.gcpJobId} scheduled at ${cron}`,
    200,
  );
}
