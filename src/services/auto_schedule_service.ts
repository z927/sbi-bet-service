import { getSettings, type Settings } from "../config.ts";
import { ConflictError, baseResponse } from "../errors.ts";
import type { BaseResponse } from "../types.ts";
import { client as feedClient, FeedError } from "../scraper/client/index.ts";
import * as db from "../scraper/db.ts";
import type { Match } from "../scraper/models.ts";
import { defaultSchedulerClient, type SchedulerClient } from "../cloud_scheduler/client.ts";
import { configuredMajorLeagues, isMajorLeague } from "./strategies/major_leagues.ts";
import { buildCron, cronHitsDay } from "./cron.ts";
import { getLogger, type AppLogger } from "../logger.ts";

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

/**
 * Names of the environment variables that are still missing before the
 * Cloud Scheduler job can be created.
 */
const missingSchedulerSettings = (settings: Settings): string[] => {
  const missing: string[] = [];
  if (settings.gcpProjectId === "") {
    missing.push("GCP_PROJECT_ID");
  }
  if (settings.gcpJobId === "") {
    missing.push("GCP_JOB_ID");
  }
  if (settings.monitorJobTargetBaseUrl === "") {
    missing.push("MONITOR_JOB_TARGET_BASE_URL");
  }
  return missing;
}

const schedulerEnabled = (settings: Settings): boolean => {
  return missingSchedulerSettings(settings).length === 0;
}

interface MatchSelection {
  upcoming: Match[];
  rejectedLeagues: { tournament: string; count: number }[];
  missingStartTime: number;
  alreadyStarted: number;
}

/**
 * Splits the feed into "schedulable" matches and the reasons why the others
 * were dropped. The breakdown is what makes a silent empty schedule debuggable.
 */
const selectUpcoming = (matches: Match[], allowlist: readonly string[], nowEpoch: number): MatchSelection => {
  const upcoming: Match[] = [];
  const rejected = new Map<string, number>();
  let missingStartTime = 0;
  let alreadyStarted = 0;
  for (const match of matches) {
    if (!isMajorLeague(match, allowlist)) {
      const tournament = (match.tournament ?? "").trim() || "<senza nome>";
      rejected.set(tournament, (rejected.get(tournament) ?? 0) + 1);
      continue;
    }
    const start = asEpoch(match.start_time);
    if (start === null) {
      missingStartTime += 1;
      continue;
    }
    if (start < nowEpoch) {
      alreadyStarted += 1;
      continue;
    }
    upcoming.push(match);
  }
  return {
    upcoming,
    rejectedLeagues: [...rejected.entries()].map(([tournament, count]) => ({ tournament, count })),
    missingStartTime,
    alreadyStarted,
  };
}

const enrichWindows = async (matches: Match[], leadMinutes: number, log: AppLogger): Promise<void> => {
  await pool(matches, DETAIL_WORKERS, async (match) => {
    const start = asEpoch(match.start_time);
    if (start === null) {
      log.warn({ matchId: match.id, tournament: match.tournament }, "match skipped: missing start_time");
      return;
    }
    let endTime: number | null = null;
    try {
      const detail = await feedClient.getMatch(match.id);
      match.detail = detail;
      endTime = asEpoch(detail["end_time"]);
      if (endTime !== null && endTime <= 0) {
        // The feed reports end_time=0 while the match has not finished yet.
        endTime = null;
      }
      if (endTime === null) {
        log.warn(
          { matchId: match.id, home: match.home, away: match.away },
          "match detail has no end_time: falling back to start + 2h",
        );
      }
    } catch (exc) {
      if (!(exc instanceof FeedError)) {
        throw exc;
      }
      log.warn(
        { err: exc, matchId: match.id, home: match.home, away: match.away },
        "match detail feed failed: falling back to start + 2h",
      );
    }
    match["begin_monitoring_time"] = start - leadMinutes * 60;
    match["end_monitoring_time"] = endTime ?? start + FALLBACK_END_OFFSET_SECONDS;
    match["monitored"] = true;
    log.debug(
      {
        matchId: match.id,
        home: match.home,
        away: match.away,
        startTime: start,
        beginMonitoringTime: match["begin_monitoring_time"],
        endMonitoringTime: match["end_monitoring_time"],
        usedFallbackEnd: endTime === null,
      },
      "monitoring window computed",
    );
  });
}

export const autoScheduleEvents = async (
  scheduler: SchedulerClient = defaultSchedulerClient(),
  log: AppLogger = getLogger(),
): Promise<BaseResponse> => {
  const settings = getSettings();
  const now = new Date();
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const allowlist = configuredMajorLeagues();
  const missing = missingSchedulerSettings(settings);

  log.info(
    {
      now: now.toISOString(),
      sport: SPORT_CALCIO,
      schedulerEnabled: missing.length === 0,
      missingSchedulerSettings: missing,
      gcpProjectId: settings.gcpProjectId,
      gcpRegion: settings.gcpRegion,
      gcpJobId: settings.gcpJobId,
      monitorJobTargetBaseUrl: settings.monitorJobTargetBaseUrl,
      schedulerTimeZone: settings.schedulerTimeZone,
      monitorLeadMinutes: settings.monitorLeadMinutes,
      schedulerCronStepMinutes: settings.schedulerCronStepMinutes,
      allowlistSize: allowlist.length,
    },
    "auto-schedule started",
  );

  try {
    const dayMatches = await feedClient.listMatches(SPORT_CALCIO);
    log.info({ fetched: dayMatches.length }, "match list fetched");

    const { upcoming, rejectedLeagues, missingStartTime, alreadyStarted } = selectUpcoming(
      dayMatches,
      allowlist,
      nowEpoch,
    );
    const rejectedByLeague = dayMatches.length - upcoming.length - missingStartTime - alreadyStarted;
    log.info(
      {
        fetched: dayMatches.length,
        upcoming: upcoming.length,
        rejectedByLeague,
        missingStartTime,
        alreadyStarted,
      },
      "match selection completed",
    );

    if (upcoming.length === 0) {
      log.warn(
        {
          fetched: dayMatches.length,
          rejectedByLeague,
          missingStartTime,
          alreadyStarted,
          rejectedLeagues,
          allowlist,
        },
        "no upcoming major-league matches found: nothing to schedule",
      );
      if (schedulerEnabled(settings)) {
        log.info({ jobId: settings.gcpJobId }, "deleting scheduler job: no upcoming matches");
        await scheduler.deleteJob(settings.gcpJobId);
      }
      return baseResponse("Auto-schedule completed: no upcoming major-league matches", 200);
    }

    log.info(
      { count: upcoming.length, leadMinutes: settings.monitorLeadMinutes },
      "enriching monitoring windows",
    );
    await enrichWindows(upcoming, settings.monitorLeadMinutes, log);

    const stored = db.upsertMatches(upcoming);
    log.info({ count: upcoming.length, stored }, "monitoring windows persisted");

    const windows = upcoming.map((match) => ({
      begin: asEpoch(match["begin_monitoring_time"]) ?? 0,
      end: asEpoch(match["end_monitoring_time"]) ?? 0,
    }));
    const cron = buildCron(windows, settings.schedulerTimeZone, now, settings.schedulerCronStepMinutes);
    log.info(
      {
        windows: windows.length,
        cron,
        timeZone: settings.schedulerTimeZone,
        stepMinutes: settings.schedulerCronStepMinutes,
        monitoringWindows: windows,
      },
      "cron expression computed",
    );
    if (cron === null) {
      log.warn({ windows: windows.length }, "no future monitoring window left: cron not scheduled");
      return baseResponse(
        `Auto-schedule completed: ${upcoming.length} fixtures monitored, no future start times left to schedule`,
        200,
      );
    }

    if (missing.length > 0) {
      log.warn({ missing, cron }, "cloud scheduler not configured: job not created");
      return baseResponse(
        `Auto-schedule completed: ${upcoming.length} fixtures monitored (Cloud Scheduler not configured, cron ${cron})`,
        200,
      );
    }

    const input = {
      schedule: cron,
      timeZone: settings.schedulerTimeZone,
      httpTarget: {
        httpMethod: "GET",
        uri: `${settings.monitorJobTargetBaseUrl.replace(/\/+$/, "")}/api/v1/monitor`,
      },
    };

    const existing = await scheduler.getJob(settings.gcpJobId);
    log.info(
      {
        jobId: settings.gcpJobId,
        exists: existing !== null,
        existingSchedule: existing?.schedule ?? null,
        existingTimeZone: existing?.timeZone ?? null,
        existingUri: existing?.httpTarget?.uri ?? null,
      },
      "existing scheduler job fetched",
    );
    if (existing && cronHitsDay(existing.schedule, settings.schedulerTimeZone, now)) {
      log.warn(
        { jobId: settings.gcpJobId, existingSchedule: existing.schedule, cron },
        "auto-schedule already executed today: conflict",
      );
      throw new ConflictError(`Auto-schedule already executed for today (job ${settings.gcpJobId} fires today)`);
    }
    if (existing) {
      log.info(
        { jobId: settings.gcpJobId, schedule: cron, uri: input.httpTarget.uri, action: "update" },
        "updating cloud scheduler job",
      );
      await scheduler.updateJob(settings.gcpJobId, input);
    } else {
      log.info(
        { jobId: settings.gcpJobId, schedule: cron, uri: input.httpTarget.uri, action: "create" },
        "creating cloud scheduler job",
      );
      await scheduler.createJob(input);
    }
    const response = baseResponse(
      `Auto-schedule completed: ${upcoming.length} fixtures monitored, job ${settings.gcpJobId} scheduled at ${cron}`,
      200,
    );
    log.info({ statusCode: response.statusCode, message: response.message }, "auto-schedule completed");
    return response;
  } catch (exc) {
    if (exc instanceof ConflictError) {
      log.warn({ err: exc }, "auto-schedule aborted: conflict");
    } else {
      log.error({ err: exc }, "auto-schedule failed");
    }
    throw exc;
  }
};
