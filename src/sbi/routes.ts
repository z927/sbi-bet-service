import type { FastifyInstance } from "fastify";
import { ValidationError } from "../errors.ts";
import { isIsoDate } from "../validation.ts";
import type { ScheduleRequest } from "../types.ts";
import * as schedule from "../services/schedule_service.ts";
import * as autoSchedule from "../services/auto_schedule_service.ts";
import * as monitoring from "../services/monitoring_service.ts";
import * as matches from "../services/matches_service.ts";

export interface RouteMetadata {
  method: "GET" | "POST";
  path: string;
  operationId: string;
}

export const SBI_ROUTES: readonly RouteMetadata[] = [
  { method: "POST", path: "/api/v1/schedule", operationId: "scheduleEvents" },
  { method: "GET", path: "/api/v1/auto-schedule", operationId: "autoScheduleEvents" },
  { method: "GET", path: "/api/v1/monitor", operationId: "monitorFixtures" },
  { method: "GET", path: "/api/v1/scheduled-fixtures", operationId: "getScheduledFixtures" },
  { method: "GET", path: "/api/v1/monitored", operationId: "getMonitoredFixtures" },
  { method: "GET", path: "/api/v1/matches", operationId: "getMatches" },
];

const defaultItemSchema = {
  type: "object",
  properties: {
    fixtureId: { type: "integer" },
    match: { type: "string" },
  },
} as const;

const favouriteItemSchema = {
  type: "object",
  properties: {
    fixtureId: { type: "integer" },
    match: { type: "string" },
    homeTeam: { type: "boolean" },
    awayTeam: { type: "boolean" },
  },
} as const;

const scheduleRequestSchema = {
  type: "object",
  properties: {
    defaultFixtures: { type: "array", items: defaultItemSchema },
    favouriteFixtures: { type: "array", items: favouriteItemSchema },
  },
} as const;

const dayQuerySchema = {
  type: "object",
  properties: { day: { type: "string" } },
} as const;

const dateQuerySchema = {
  type: "object",
  properties: { date: { type: "string" } },
} as const;

const assertIsoDate = (value: string | undefined, field: string): void => {
  if (value !== undefined && !isIsoDate(value)) {
    throw new ValidationError(`${field} must be a valid ISO date (YYYY-MM-DD)`);
  }
}

export const sbiRoutes = (app: FastifyInstance): void => {
  app.post<{ Body: ScheduleRequest; Querystring: { day?: string } }>(
    "/api/v1/schedule",
    {
      schema: {
        operationId: "scheduleEvents",
        body: scheduleRequestSchema,
        querystring: dayQuerySchema,
      },
    },
    (request) => {
      assertIsoDate(request.query.day, "day");
      return schedule.scheduleEvents(request.body ?? {}, request.query.day);
    },
  );

  app.get("/api/v1/auto-schedule", { schema: { operationId: "autoScheduleEvents" } }, () =>
    autoSchedule.autoScheduleEvents(),
  );

  app.get("/api/v1/monitor", { schema: { operationId: "monitorFixtures" } }, async () =>
    monitoring.monitorFixtures(),
  );

  app.get("/api/v1/scheduled-fixtures", { schema: { operationId: "getScheduledFixtures" } }, () =>
    matches.getScheduledFixtures(),
  );

  app.get("/api/v1/monitored", { schema: { operationId: "getMonitoredFixtures" } }, () =>
    monitoring.getMonitoredFixtures(),
  );

  app.get<{ Querystring: { date?: string } }>(
    "/api/v1/matches",
    { schema: { operationId: "getMatches", querystring: dateQuerySchema } },
    (request) => {
      assertIsoDate(request.query.date, "date");
      return matches.getMatches(request.query.date);
    },
  );
}
