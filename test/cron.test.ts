import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCron, cronHitsDay } from "../src/services/cron.ts";

const NOW = new Date("2026-10-18T10:00:00Z"); // Sunday
const utc = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000);

test("buildCron emits step minutes and one hour range per window", () => {
  const cron = buildCron(
    [
      { begin: utc("2026-10-18T15:10:00Z"), end: utc("2026-10-18T17:00:00Z") },
      { begin: utc("2026-10-18T18:00:00Z"), end: utc("2026-10-18T20:45:00Z") },
    ],
    "UTC",
    NOW,
    10,
  );
  assert.equal(cron, "*/10 15-17,18-20 18 10 SUN");
});

test("buildCron collapses a same-hour window to a single hour value", () => {
  const cron = buildCron(
    [{ begin: utc("2026-10-18T18:10:00Z"), end: utc("2026-10-18T18:50:00Z") }],
    "UTC",
    NOW,
    10,
  );
  assert.equal(cron, "*/10 18 18 10 SUN");
});

test("buildCron dedups identical ranges but keeps overlapping ones", () => {
  const cron = buildCron(
    [
      { begin: utc("2026-10-18T15:00:00Z"), end: utc("2026-10-18T17:00:00Z") },
      { begin: utc("2026-10-18T15:30:00Z"), end: utc("2026-10-18T17:00:00Z") },
      { begin: utc("2026-10-18T16:00:00Z"), end: utc("2026-10-18T18:00:00Z") },
    ],
    "UTC",
    NOW,
    10,
  );
  assert.equal(cron, "*/10 15-17,16-18 18 10 SUN");
});

test("buildCron keeps a window in progress and drops past ones", () => {
  const cron = buildCron(
    [
      { begin: utc("2026-10-18T08:00:00Z"), end: utc("2026-10-18T09:00:00Z") },
      { begin: utc("2026-10-18T09:30:00Z"), end: utc("2026-10-18T11:30:00Z") },
    ],
    "UTC",
    NOW,
    10,
  );
  assert.equal(cron, "*/10 9-11 18 10 SUN");
});

test("buildCron returns null when no window remains", () => {
  assert.equal(buildCron([], "UTC", NOW, 10), null);
  assert.equal(
    buildCron([{ begin: utc("2026-10-18T08:00:00Z"), end: utc("2026-10-18T09:00:00Z") }], "UTC", NOW, 10),
    null,
  );
  assert.equal(
    buildCron([{ begin: Number.NaN, end: Number.POSITIVE_INFINITY }], "UTC", NOW, 10),
    null,
  );
});

test("buildCron clamps a midnight-crossing window to the current day", () => {
  const cron = buildCron(
    [{ begin: utc("2026-10-18T23:30:00Z"), end: utc("2026-10-19T01:15:00Z") }],
    "UTC",
    NOW,
    10,
  );
  assert.equal(cron, "*/10 23 18 10 SUN");
});

test("buildCron converts windows into the target timezone", () => {
  const cron = buildCron(
    [{ begin: utc("2026-10-18T18:45:00Z"), end: utc("2026-10-18T20:30:00Z") }],
    "Europe/Rome",
    NOW,
    10,
  );
  assert.equal(cron, "*/10 20-22 18 10 SUN");
});

test("buildCron sets the day-of-week to the weekday of now", () => {
  const wednesday = new Date("2026-10-21T10:00:00Z");
  const cron = buildCron(
    [{ begin: utc("2026-10-21T15:00:00Z"), end: utc("2026-10-21T17:00:00Z") }],
    "UTC",
    wednesday,
    10,
  );
  assert.equal(cron, "*/10 15-17 21 10 WED");
});

test("buildCron honours a custom step and falls back to 10 on invalid values", () => {
  const window = [{ begin: utc("2026-10-18T15:00:00Z"), end: utc("2026-10-18T17:00:00Z") }];
  assert.match(buildCron(window, "UTC", NOW, 5)!, /^\*\/5 /);
  assert.match(buildCron(window, "UTC", NOW, 0)!, /^\*\/10 /);
  assert.match(buildCron(window, "UTC", NOW, Number.NaN)!, /^\*\/10 /);
});

test("cronHitsDay matches the pinned day and month only", () => {
  const cron = "*/10 15-17,18-20 18 10 SUN";
  assert.equal(cronHitsDay(cron, "UTC", new Date("2026-10-18T12:00:00Z")), true);
  assert.equal(cronHitsDay(cron, "UTC", new Date("2026-10-19T12:00:00Z")), false);
  assert.equal(cronHitsDay(cron, "UTC", new Date("2026-11-18T12:00:00Z")), false);
});

test("cronHitsDay treats wildcard fields as always matching and rejects malformed cron", () => {
  assert.equal(cronHitsDay("0 12 * * *", "UTC", new Date("2026-10-18T12:00:00Z")), true);
  assert.equal(cronHitsDay("0 12", "UTC", NOW), false);
});
