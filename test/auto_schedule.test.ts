import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { autoScheduleEvents } from "../src/services/auto_schedule_service.ts";
import { buildCron, cronHitsDay } from "../src/services/cron.ts";
import type {
  JobScheduleInput,
  SchedulerClient,
  SchedulerJob,
} from "../src/cloud_scheduler/client.ts";
import { ConflictError } from "../src/errors.ts";
import { FeedError } from "../src/clients/diretta/transport.ts";
import type { AppLogger } from "../src/logger.ts";
import * as db from "../src/scraper/db.ts";
import { resetMappingStore, upsertLeagueLink } from "../src/mapping/repo.ts";
import { upsertTeams, deleteAllTeams, initTeamsRepo } from "../src/services/teams_repo.ts";
import { removeDb, useTempDb } from "./support.ts";

process.env["LOG_LEVEL"] = "debug";
process.env["GCP_PROJECT_ID"] = "test-project";
process.env["GCP_REGION"] = "europe-west6";
process.env["GCP_JOB_ID"] = "test-job";
process.env["MONITOR_JOB_TARGET_BASE_URL"] = "https://svc.example.run.app/";
process.env["SCHEDULER_TIME_ZONE"] = "UTC";
process.env["MONITOR_LEAD_MINUTES"] = "5";
process.env["MONITOR_MAJOR_LEAGUES"] = "ITALIA: Serie A,INGHILTERRA: Premier League";
process.env["SUPABASE_URL"] = "";
process.env["SUPABASE_SERVICE_ROLE_KEY"] = "";

const DB_FILE = useTempDb("auto-schedule");
const originalFetch = globalThis.fetch;

const FIELD = "\u00ac";
const KV = "\u00f7";
// Use a fixed future timestamp (1 year from now) to ensure fixtures are always upcoming
const BASE = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
const future = (seconds: number) => BASE + seconds;

const league = (name: string, id: string, country: string): string =>
  [`ZA${KV}${name}`, `ZY${KV}${country}`, `ZEE${KV}${id}`].join(FIELD);
const fixture = (id: string, start: number, home: string, away: string): string =>
  [`AA${KV}${id}`, `AD${KV}${start}`, `AE${KV}${home}`, `AF${KV}${away}`].join(FIELD);
const detail = (end: number | null): string =>
  [`DC${KV}${BASE}`, end === null ? `DS${KV}` : `DS${KV}${end}`].join(FIELD);

const makeResponse = (body: string): Response => {
  return { ok: true, status: 200, text: async () => body } as unknown as Response;
}

// Helper to compute fixture start times for today
const today = new Date().toISOString().split("T")[0];
const fixtureStart1 = Math.floor(new Date(`${today}T23:00:00+00:00`).getTime() / 1000); // Inter vs Milan
const fixtureStart2 = Math.floor(new Date(`${today}T23:30:00+00:00`).getTime() / 1000); // Arsenal vs Chelsea

// API Football response builders
const apiFootballLeague = (id: number, name: string, country: string) => ({
  league: { id, name, country, logo: "", flag: "", season: 2024, round: "Regular Season" },
  fixture: { id: 0, date: "", timestamp: 0, timezone: "UTC", periods: { first: 0, second: 0 }, venue: { id: 0, name: "", city: "" }, status: { long: "", short: "", elapsed: 0 } },
  teams: { home: { id: 0, name: "", logo: "", winner: false }, away: { id: 0, name: "", logo: "", winner: false } },
  goals: { home: 0, away: 0 },
  score: { halftime: { home: 0, away: 0 }, fulltime: { home: 0, away: 0 }, extratime: { home: 0, away: 0 }, penalty: { home: 0, away: 0 } },
});

const apiFootballFixture = (fixtureId: number, date: string, homeId: number, homeName: string, awayId: number, awayName: string, leagueId: number, leagueName: string, country: string) => ({
  fixture: { id: fixtureId, date, timestamp: Math.floor(new Date(date).getTime() / 1000), timezone: "UTC", periods: { first: 0, second: 0 }, venue: { id: 0, name: "", city: "" }, status: { long: "Not Started", short: "NS", elapsed: 0 } },
  league: { id: leagueId, name: leagueName, country, logo: "", flag: "", season: 2024, round: "Regular Season" },
  teams: { home: { id: homeId, name: homeName, logo: "", winner: false }, away: { id: awayId, name: awayName, logo: "", winner: false } },
  goals: { home: null, away: null },
  score: { halftime: { home: 0, away: 0 }, fulltime: { home: 0, away: 0 }, extratime: { home: 0, away: 0 }, penalty: { home: 0, away: 0 } },
});

interface RecordedCall {
  op: "get" | "create" | "update" | "delete";
  jobId: string;
  input?: JobScheduleInput;
}

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  obj: Record<string, unknown>;
  msg?: string;
}

class RecordingLogger implements AppLogger {
  entries: LogEntry[] = [];

  debug(obj: object, msg?: string): void {
    this.entries.push({ level: "debug", obj: obj as Record<string, unknown>, msg });
  }

  info(obj: object, msg?: string): void {
    this.entries.push({ level: "info", obj: obj as Record<string, unknown>, msg });
  }

  warn(obj: object, msg?: string): void {
    this.entries.push({ level: "warn", obj: obj as Record<string, unknown>, msg });
  }

  error(obj: object, msg?: string): void {
    this.entries.push({ level: "error", obj: obj as Record<string, unknown>, msg });
  }

  find(level: LogLevel, msg: string): LogEntry | undefined {
    return this.entries.find((entry) => entry.level === level && entry.msg === msg);
  }
}

class StubScheduler implements SchedulerClient {
  jobs = new Map<string, SchedulerJob>();
  calls: RecordedCall[] = [];

  async getJob(jobId: string): Promise<SchedulerJob | null> {
    this.calls.push({ op: "get", jobId });
    return this.jobs.get(jobId) ?? null;
  }

  async createJob(input: JobScheduleInput): Promise<SchedulerJob> {
    this.calls.push({ op: "create", jobId: "test-job", input });
    const job: SchedulerJob = { name: "projects/test-project/locations/europe-west6/jobs/test-job", ...input };
    this.jobs.set("test-job", job);
    return job;
  }

  async updateJob(jobId: string, input: JobScheduleInput): Promise<SchedulerJob> {
    this.calls.push({ op: "update", jobId, input });
    const job: SchedulerJob = { name: `projects/test-project/locations/europe-west6/jobs/${jobId}`, ...input };
    this.jobs.set(jobId, job);
    return job;
  }

  async deleteJob(jobId: string): Promise<void> {
    this.calls.push({ op: "delete", jobId });
    this.jobs.delete(jobId);
  }
}

const buildApiFootballFixtures = (): any[] => {
  const today = new Date().toISOString().split("T")[0];
  // Use a time later today (23:00) to ensure fixtures are upcoming
  const futureTimeToday = `${today}T23:00:00+00:00`;
  const laterToday = `${today}T23:30:00+00:00`;
  return [
    // Inter vs Milan - Serie A (monitored via league_links) - today at 23:00
    apiFootballFixture(1001, futureTimeToday, 505, "Inter", 487, "Milan", 135, "Serie A", "Italy"),
    // Roma vs Lazio - Serie A (monitored) - already started (earlier today)
    apiFootballFixture(1002, new Date(Date.now() - 3600 * 1000).toISOString(), 487, "Roma", 505, "Lazio", 135, "Serie A", "Italy"),
    // Arsenal vs Chelsea - Premier League (monitored via league_links) - today at 23:30
    apiFootballFixture(1003, laterToday, 42, "Arsenal", 49, "Chelsea", 39, "Premier League", "England"),
    // Padova vs Vicenza - Serie C (NOT in league_links) - today at 23:00
    apiFootballFixture(1004, futureTimeToday, 999, "Padova", 998, "Vicenza", 999, "Serie C", "Italy"),
  ];
};

const mockFetch = (apiFixtures: any[], direttaFeed: string): void => {
  globalThis.fetch = (async (url: string) => {
    const target = String(url);
    
    // API Football fixtures endpoint - filter by date query parameter
    if (target.includes("v3.football.api-sports.io/fixtures")) {
      const urlObj = new URL(target);
      const requestedDate = urlObj.searchParams.get("date");
      let filteredFixtures = apiFixtures;
      if (requestedDate) {
        filteredFixtures = apiFixtures.filter(f => f.fixture.date.startsWith(requestedDate));
      }
      return makeResponse(JSON.stringify({ response: filteredFixtures }));
    }
    
    // Diretta match detail endpoints
    if (target.includes("dc_1_m1")) {
      return makeResponse(detail(future(3600 + 7000)));
    }
    if (target.includes("dc_1_m3")) {
      return makeResponse(detail(null));
    }
    if (target.includes("dc_1_m4")) {
      return makeResponse(detail(future(3600 + 7000)));
    }
    
    // Diretta match list endpoint
    if (target.includes("f_1_0_3_it_1")) {
      return makeResponse(direttaFeed);
    }
    
    return makeResponse(direttaFeed);
  }) as unknown as typeof fetch;
};

const buildDirettaFeed = (): string => {
  return [
    league("ITALIA: Serie A", "COuk57Ci", "Italia"),
    fixture("m1", future(3600), "Inter", "Milan"),
    fixture("m2", future(-3600), "Roma", "Lazio"),
    league("INGHILTERRA: Premier League", "Cp0ZbF2i", "Inghilterra"),
    fixture("m3", future(7200), "Arsenal", "Chelsea"),
    league("ITALIA: Serie C", "CzESFqCV", "Italia"),
    fixture("m4", future(3600), "Padova", "Vicenza"),
  ].join("~");
};

let stub: StubScheduler;

before(() => {
  db.initDb();
});

beforeEach(async () => {
  stub = new StubScheduler();
  await db.deleteAll();
  // Reset mapping store and populate league_links (the source of truth for monitored leagues)
  resetMappingStore();
  await upsertLeagueLink({ apiFootballLeagueId: 135, direttaTournamentId: "COuk57Ci", name: "ITALIA: Serie A" });
  await upsertLeagueLink({ apiFootballLeagueId: 39, direttaTournamentId: "Cp0ZbF2i", name: "INGHILTERRA: Premier League" });
  // NOTE: Serie C (999) is intentionally NOT linked, so it will be rejected.
  // Populate the teams table (diretta_name <-> api_football_id bridge used for Diretta matching).
  deleteAllTeams();
  initTeamsRepo();
  await upsertTeams([
    { diretta_name: "Inter", api_football_id: 505, api_football_name: "Inter", api_football_league_id: 135, country: "Italy" },
    { diretta_name: "Milan", api_football_id: 487, api_football_name: "Milan", api_football_league_id: 135, country: "Italy" },
    { diretta_name: "Arsenal", api_football_id: 42, api_football_name: "Arsenal", api_football_league_id: 39, country: "England" },
    { diretta_name: "Chelsea", api_football_id: 49, api_football_name: "Chelsea", api_football_league_id: 39, country: "England" },
  ]);
  mockFetch(buildApiFootballFixtures(), buildDirettaFeed());
});

after(() => {
  globalThis.fetch = originalFetch;
  removeDb(DB_FILE);
});

test("filters by league_links, persists monitored fixtures with both IDs and creates a single job", async () => {
  const result = await autoScheduleEvents(stub);
  assert.equal(result.statusCode, 200);
  assert.match(result.message ?? "", /2 fixtures monitored/);

  const stored = await db.getMatches(null, "today", null, 100);
  const ids = stored.map((match: any) => match.id).sort();
  assert.deepEqual(ids, ["m1", "m3"]);

  const m1 = (await db.getMatch("m1"))!;
  assert.equal((m1 as any)["monitored"], true);
  assert.equal((m1 as any)["begin_monitoring_time"], fixtureStart1 - 300);
  assert.ok((m1 as any)["end_monitoring_time"] > fixtureStart1);

  const m3 = (await db.getMatch("m3"))!;
  assert.equal((m3 as any)["monitored"], true);
  // m3 detail feed returns null, so fallback to start + 2h
  assert.equal((m3 as any)["end_monitoring_time"], fixtureStart2 + 7200);

  // Verify scheduled_fixtures has both fixture_id (API Football) and match_id (Diretta)
  const scheduled = await (await import("../src/services/scheduled_fixtures_repo.ts")).getScheduledFixtures();
  const byFixture = new Map(scheduled.map((s: any) => [s.fixture_id, s]));
  assert.ok(byFixture.has(1001), "fixture 1001 (Inter-Milan) should be in scheduled_fixtures");
  assert.ok(byFixture.has(1003), "fixture 1003 (Arsenal-Chelsea) should be in scheduled_fixtures");
  assert.equal((byFixture.get(1001) as any).match_id, "m1");
  assert.equal((byFixture.get(1003) as any).match_id, "m3");

  const created = stub.calls.find((call) => call.op === "create");
  assert.ok(created);
  assert.equal(created.jobId, "test-job");
  const input = created.input!;
  assert.equal(input.timeZone, "UTC");
  assert.equal(input.httpTarget.httpMethod, "GET");
  assert.equal(input.httpTarget.uri, "https://svc.example.run.app/api/v1/monitor");
  assert.equal(input.httpTarget.body, undefined);
  assert.equal(input.httpTarget.headers, undefined);
  const [minute, hours, day, month, weekday] = input.schedule.split(" ");
  assert.equal(minute, "*/10");
  assert.match(hours!, /^(\d+(-\d+)?)(,(\d+(-\d+)?))*$/);
  assert.equal(hours!.split(",").length, 2);
  const today = new Date();
  assert.equal(Number(day), today.getUTCDate());
  assert.equal(Number(month), today.getUTCMonth() + 1);
  assert.ok(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].includes(weekday!));
});

test("continues when a detail feed fails and falls back to start + 2h", async () => {
  globalThis.fetch = (async (url: string) => {
    const target = String(url);
    if (target.includes("v3.football.api-sports.io/fixtures")) {
      return makeResponse(JSON.stringify({ response: buildApiFootballFixtures() }));
    }
    if (target.includes("dc_1_m1")) {
      throw new FeedError("mock detail failure");
    }
    if (target.includes("dc_1_m3")) {
      return makeResponse(detail(null));
    }
    if (target.includes("dc_1_m4")) {
      return makeResponse(detail(future(3600 + 7000)));
    }
    if (target.includes("f_1_0_3_it_1")) {
      return makeResponse(buildDirettaFeed());
    }
    return makeResponse(buildDirettaFeed());
  }) as unknown as typeof fetch;

  const result = await autoScheduleEvents(stub);
  assert.equal(result.statusCode, 200);
  const m1 = (await db.getMatch("m1"))!;
  assert.equal((m1 as any)["end_monitoring_time"], fixtureStart1 + 7200);
});

test("returns 409 when the existing job already fires today", async () => {
  const now = new Date();
  stub.jobs.set("test-job", {
    name: "projects/test-project/locations/europe-west6/jobs/test-job",
    schedule: buildCron(
      [{ begin: future(3600), end: future(3600 + 7000) }],
      "UTC",
      now,
      10,
    )!,
    timeZone: "UTC",
  });
  await assert.rejects(autoScheduleEvents(stub), (error: unknown) => {
    assert.ok(error instanceof ConflictError);
    return true;
  });
  assert.equal(stub.calls.some((call) => call.op === "create" || call.op === "update"), false);
});

test("updates the existing job when its schedule is from another day", async () => {
  stub.jobs.set("test-job", {
    name: "projects/test-project/locations/europe-west6/jobs/test-job",
    schedule: "0 0 1 1 *",
    timeZone: "UTC",
  });
  const result = await autoScheduleEvents(stub);
  assert.equal(result.statusCode, 200);
  const updated = stub.calls.find((call) => call.op === "update");
  assert.ok(updated);
  assert.equal(updated.jobId, "test-job");
  assert.ok(cronHitsDay(updated.input!.schedule, "UTC", new Date()));
});

test("deletes the job and returns 200 when no upcoming major-league matches exist", async () => {
  const today = new Date().toISOString().split("T")[0];
  const noUpcomingFixtures = [
    // All matches already started (earlier today)
    apiFootballFixture(1001, new Date(Date.now() - 3600 * 1000).toISOString(), 487, "Inter", 505, "Milan", 135, "Serie A", "Italy"),
    apiFootballFixture(1002, new Date(Date.now() - 7200 * 1000).toISOString(), 42, "Arsenal", 49, "Chelsea", 39, "Premier League", "England"),
  ];
  
  mockFetch(noUpcomingFixtures, buildDirettaFeed());

  stub.jobs.set("test-job", {
    name: "projects/test-project/locations/europe-west6/jobs/test-job",
    schedule: "0 0 1 1 *",
    timeZone: "UTC",
  });
  const result = await autoScheduleEvents(stub);
  assert.equal(result.statusCode, 200);
  assert.match(result.message ?? "", /no valid fixtures to schedule/);
  assert.ok(stub.calls.some((call) => call.op === "delete" && call.jobId === "test-job"));
  assert.equal(await db.countMatches(), 0);
});

test("still persists matches and skips the scheduler when it is not configured", async () => {
  const target = process.env["MONITOR_JOB_TARGET_BASE_URL"];
  delete process.env["MONITOR_JOB_TARGET_BASE_URL"];
  try {
    const result = await autoScheduleEvents(stub);
    assert.equal(result.statusCode, 200);
    assert.match(result.message ?? "", /Cloud Scheduler not configured/);
    assert.equal(await db.countMatches(), 2);
    assert.equal(stub.calls.length, 0);
  } finally {
    process.env["MONITOR_JOB_TARGET_BASE_URL"] = target;
  }
});

test("uses the configured cron step minutes", async () => {
  process.env["SCHEDULER_CRON_STEP_MINUTES"] = "5";
  try {
    const result = await autoScheduleEvents(stub);
    assert.equal(result.statusCode, 200);
    const created = stub.calls.find((call) => call.op === "create");
    assert.ok(created);
    assert.match(created.input!.schedule, /^\*\/5 /);
  } finally {
    delete process.env["SCHEDULER_CRON_STEP_MINUTES"];
  }
});

test("propagates feed failures from the matches list", async () => {
  globalThis.fetch = (async (url: string) => {
    const target = String(url);
    if (target.includes("f_1_0_3_it_1")) {
      throw new FeedError("mock feed failure");
    }
    if (target.includes("v3.football.api-sports.io/fixtures")) {
      return makeResponse(JSON.stringify({ response: buildApiFootballFixtures() }));
    }
    return makeResponse(buildDirettaFeed());
  }) as unknown as typeof fetch;
  await assert.rejects(autoScheduleEvents(stub), (error: unknown) => {
    assert.ok(error instanceof FeedError);
    return true;
  });
});

test("treats a zero end_time as missing and falls back to start + 2h", async () => {
  globalThis.fetch = (async (url: string) => {
    const target = String(url);
    if (target.includes("v3.football.api-sports.io/fixtures")) {
      return makeResponse(JSON.stringify({ response: buildApiFootballFixtures() }));
    }
    if (target.includes("dc_1_m1")) {
      return makeResponse(detail(0));
    }
    if (target.includes("dc_1_m3")) {
      return makeResponse(detail(0));
    }
    if (target.includes("f_1_0_3_it_1")) {
      return makeResponse(buildDirettaFeed());
    }
    return makeResponse(buildDirettaFeed());
  }) as unknown as typeof fetch;

  const log = new RecordingLogger();
  const result = await autoScheduleEvents(stub, log);
  assert.equal(result.statusCode, 200);
  assert.match(result.message ?? "", /job test-job scheduled at/);

  const m1 = (await db.getMatch("m1"))!;
  assert.equal((m1 as any)["end_monitoring_time"], fixtureStart1 + 7200);
  assert.ok(log.find("warn", "match detail has no end_time: falling back to start + 2h"));

  const created = stub.calls.find((call) => call.op === "create");
  assert.ok(created);
});

test("logs the effective settings, the match selection and the scheduler outcome", async () => {
  const log = new RecordingLogger();
  const result = await autoScheduleEvents(stub, log);
  assert.equal(result.statusCode, 200);

  const started = log.find("info", "auto-schedule started (league-links driven)");
  assert.ok(started);
  assert.equal(started.obj["gcpJobId"], "test-job");
  assert.equal(started.obj["schedulerEnabled"], true);
  assert.deepEqual(started.obj["missingSchedulerSettings"], []);
  assert.equal(started.obj["schedulerTimeZone"], "UTC");
  assert.equal(started.obj["monitorLeadMinutes"], 5);

  const fetched = log.find("info", "API Football fixtures fetched");
  assert.ok(fetched);
  assert.equal(fetched.obj["fetched"], 4);

  const selection = log.find("info", "fixture selection completed");
  assert.ok(selection);
  assert.equal(selection.obj["valid"], 2);
  assert.equal(selection.obj["rejectedByLeague"], 1);
  assert.equal(selection.obj["alreadyStarted"], 1);
  assert.equal(selection.obj["missingStartTime"], 0);
  assert.equal(selection.obj["noLeagueLink"], 1);

  const created = log.find("info", "creating cloud scheduler job");
  assert.ok(created);
  assert.equal(created.obj["action"], "create");
  assert.equal(created.obj["jobId"], "test-job");
  assert.equal(created.obj["uri"], "https://svc.example.run.app/api/v1/monitor");

  assert.ok(log.find("info", "auto-schedule completed"));
});

test("logs the rejection breakdown when no upcoming major-league match is found", async () => {
  const today = new Date().toISOString().split("T")[0];
  const noUpcomingFixtures = [
    // Only non-monitored league (no league_link for 999)
    apiFootballFixture(1004, `${today}T23:00:00+00:00`, 999, "Padova", 998, "Vicenza", 999, "Serie C", "Italy"),
  ];
  
  mockFetch(noUpcomingFixtures, buildDirettaFeed());

  const log = new RecordingLogger();
  const result = await autoScheduleEvents(stub, log);
  assert.equal(result.statusCode, 200);

  const warning = log.find("warn", "no valid fixtures to schedule");
  assert.ok(warning);
  const rejectedByLeague = warning.obj["rejectedByLeague"] as Array<{ tournament: string; count: number }>;
  assert.equal(rejectedByLeague.length, 1);
  assert.deepEqual(rejectedByLeague, [{ tournament: "Italy: Serie C", count: 1 }]);
});

test("logs the fallback used when the match detail feed fails", async () => {
  globalThis.fetch = (async (url: string) => {
    const target = String(url);
    if (target.includes("v3.football.api-sports.io/fixtures")) {
      return makeResponse(JSON.stringify({ response: buildApiFootballFixtures() }));
    }
    if (target.includes("dc_1_m1")) {
      throw new FeedError("mock detail failure");
    }
    if (target.includes("dc_1_m3")) {
      return makeResponse(detail(null));
    }
    if (target.includes("f_1_0_3_it_1")) {
      return makeResponse(buildDirettaFeed());
    }
    return makeResponse(buildDirettaFeed());
  }) as unknown as typeof fetch;

  const log = new RecordingLogger();
  const result = await autoScheduleEvents(stub, log);
  assert.equal(result.statusCode, 200);

  const failure = log.find("warn", "match detail feed failed: falling back to start + 2h");
  assert.ok(failure);
  assert.equal(failure.obj["matchId"], "m1");
  assert.ok(log.find("warn", "match detail has no end_time: falling back to start + 2h"));
});

test("logs the conflict before throwing it", async () => {
  const now = new Date();
  stub.jobs.set("test-job", {
    name: "projects/test-project/locations/europe-west6/jobs/test-job",
    schedule: buildCron([{ begin: future(3600), end: future(3600 + 7000) }], "UTC", now, 10)!,
    timeZone: "UTC",
  });

  const log = new RecordingLogger();
  await assert.rejects(autoScheduleEvents(stub, log), (error: unknown) => {
    assert.ok(error instanceof ConflictError);
    return true;
  });
  assert.ok(log.find("warn", "auto-schedule already executed today: conflict"));
  assert.ok(log.find("warn", "auto-schedule aborted: conflict"));
});

test("logs the missing scheduler configuration", async () => {
  const target = process.env["MONITOR_JOB_TARGET_BASE_URL"];
  delete process.env["MONITOR_JOB_TARGET_BASE_URL"];
  try {
    const log = new RecordingLogger();
    const result = await autoScheduleEvents(stub, log);
    assert.equal(result.statusCode, 200);

    const warning = log.find("warn", "cloud scheduler not configured: job not created");
    assert.ok(warning);
    assert.deepEqual(warning.obj["missing"], ["MONITOR_JOB_TARGET_BASE_URL"]);

    const started = log.find("info", "auto-schedule started (league-links driven)");
    assert.ok(started);
    assert.equal(started.obj["schedulerEnabled"], false);
    assert.deepEqual(started.obj["missingSchedulerSettings"], ["MONITOR_JOB_TARGET_BASE_URL"]);
  } finally {
    process.env["MONITOR_JOB_TARGET_BASE_URL"] = target;
  }
});

test("logs a failure raised while listing the matches", async () => {
  globalThis.fetch = (async (url: string) => {
    const target = String(url);
    if (target.includes("f_1_0_3_it_1")) {
      throw new FeedError("mock feed failure");
    }
    if (target.includes("v3.football.api-sports.io/fixtures")) {
      return makeResponse(JSON.stringify({ response: buildApiFootballFixtures() }));
    }
    return makeResponse(buildDirettaFeed());
  }) as unknown as typeof fetch;

  const log = new RecordingLogger();
  await assert.rejects(autoScheduleEvents(stub, log), (error: unknown) => {
    assert.ok(error instanceof FeedError);
    return true;
  });
  const failure = log.find("error", "auto-schedule failed");
  assert.ok(failure);
  assert.ok(failure.obj["err"] instanceof FeedError);
});
