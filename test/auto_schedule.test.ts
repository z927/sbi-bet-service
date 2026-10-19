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
import { FeedError } from "../src/scraper/client/transport.ts";
import * as db from "../src/scraper/db.ts";
import { removeDb, useTempDb } from "./support.ts";

process.env["LOG_LEVEL"] = "silent";
process.env["GCP_PROJECT_ID"] = "test-project";
process.env["GCP_REGION"] = "europe-west6";
process.env["GCP_JOB_ID"] = "test-job";
process.env["MONITOR_JOB_TARGET_BASE_URL"] = "https://svc.example.run.app/";
process.env["SCHEDULER_TIME_ZONE"] = "UTC";
process.env["MONITOR_LEAD_MINUTES"] = "5";
process.env["MONITOR_MAJOR_LEAGUES"] = "ITALIA: Serie A,INGHILTERRA: Premier League";

const DB_FILE = useTempDb("auto-schedule");
const originalFetch = globalThis.fetch;

const FIELD = "\u00ac";
const KV = "\u00f7";
const BASE = Math.floor(Date.now() / 1000);
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

interface RecordedCall {
  op: "get" | "create" | "update" | "delete";
  jobId: string;
  input?: JobScheduleInput;
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

const buildFeed = (): string => {
  return [
    league("ITALIA: Serie A", "COuk57Ci", "Italia"),
    fixture("m1", future(3600), "Inter", "Milan"),
    fixture("m2", future(-3600), "Roma", "Lazio"),
    league("INGHILTERRA: Premier League", "Cp0ZbF2i", "Inghilterra"),
    fixture("m3", future(7200), "Arsenal", "Chelsea"),
    league("ITALIA: Serie C", "CzESFqCV", "Italia"),
    fixture("m4", future(3600), "Padova", "Vicenza"),
  ].join("~");
}

const mockFeedFetch = (feed: string): void => {
  globalThis.fetch = (async (url: string) => {
    const target = String(url);
    if (target.includes("dc_1_m1")) {
      return makeResponse(detail(future(3600 + 7000)));
    }
    if (target.includes("dc_1_m3")) {
      return makeResponse(detail(null));
    }
    return makeResponse(feed);
  }) as unknown as typeof fetch;
}

let stub: StubScheduler;

before(() => {
  db.initDb();
});

beforeEach(() => {
  stub = new StubScheduler();
  db.deleteAll();
  mockFeedFetch(buildFeed());
});

after(() => {
  globalThis.fetch = originalFetch;
  removeDb(DB_FILE);
});

test("filters major leagues, persists monitored fixtures and creates a single job", async () => {
  const result = await autoScheduleEvents(stub);
  assert.equal(result.statusCode, 200);
  assert.match(result.message ?? "", /2 fixtures monitored/);

  const stored = db.getMatches(null, "today", null, 100);
  const ids = stored.map((match) => match.id).sort();
  assert.deepEqual(ids, ["m1", "m3"]);

  const m1 = db.getMatch("m1")!;
  assert.equal(m1["monitored"], true);
  assert.equal(m1["begin_monitoring_time"], future(3600) - 300);
  assert.equal(m1["end_monitoring_time"], future(3600 + 7000));

  const m3 = db.getMatch("m3")!;
  assert.equal(m3["monitored"], true);
  assert.equal(m3["end_monitoring_time"], future(7200) + 7200);

  const created = stub.calls.find((call) => call.op === "create");
  assert.ok(created);
  assert.equal(created.jobId, "test-job");
  const input = created.input!;
  assert.equal(input.timeZone, "UTC");
  assert.equal(input.httpTarget.httpMethod, "POST");
  assert.equal(input.httpTarget.uri, "https://svc.example.run.app/api/v1/monitor");
  assert.equal(input.httpTarget.body, Buffer.from("[]").toString("base64"));
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
    if (target.includes("dc_1_m1")) {
      throw new FeedError("mock detail failure");
    }
    if (target.includes("dc_1_m3")) {
      return makeResponse(detail(null));
    }
    return makeResponse(buildFeed());
  }) as unknown as typeof fetch;

  const result = await autoScheduleEvents(stub);
  assert.equal(result.statusCode, 200);
  const m1 = db.getMatch("m1")!;
  assert.equal(m1["end_monitoring_time"], future(3600) + 7200);
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
  globalThis.fetch = (async () =>
    makeResponse([
      league("ITALIA: Serie A", "COuk57Ci", "Italia"),
      fixture("m1", future(-3600), "Inter", "Milan"),
      league("ITALIA: Serie C", "CzESFqCV", "Italia"),
      fixture("m4", future(3600), "Padova", "Vicenza"),
    ].join("~"))) as unknown as typeof fetch;

  stub.jobs.set("test-job", {
    name: "projects/test-project/locations/europe-west6/jobs/test-job",
    schedule: "0 0 1 1 *",
    timeZone: "UTC",
  });
  const result = await autoScheduleEvents(stub);
  assert.equal(result.statusCode, 200);
  assert.match(result.message ?? "", /no upcoming major-league matches/);
  assert.ok(stub.calls.some((call) => call.op === "delete" && call.jobId === "test-job"));
  assert.equal(db.countMatches(), 0);
});

test("still persists matches and skips the scheduler when it is not configured", async () => {
  const target = process.env["MONITOR_JOB_TARGET_BASE_URL"];
  delete process.env["MONITOR_JOB_TARGET_BASE_URL"];
  try {
    const result = await autoScheduleEvents(stub);
    assert.equal(result.statusCode, 200);
    assert.match(result.message ?? "", /Cloud Scheduler not configured/);
    assert.equal(db.countMatches(), 2);
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
  globalThis.fetch = (async () => {
    throw new FeedError("mock feed failure");
  }) as unknown as typeof fetch;
  await assert.rejects(autoScheduleEvents(stub), (error: unknown) => {
    assert.ok(error instanceof FeedError);
    return true;
  });
});
