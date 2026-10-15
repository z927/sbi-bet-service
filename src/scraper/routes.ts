import type { FastifyInstance } from "fastify";
import { ValidationError } from "../errors.ts";
import type { RouteMetadata } from "../sbi/routes.ts";
import { SPORTS } from "./client/index.ts";
import * as db from "./db.ts";
import * as service from "./service.ts";

export const SCRAPER_ROUTES: readonly RouteMetadata[] = [
  { method: "GET", path: "/health", operationId: "health" },
  { method: "GET", path: "/sports", operationId: "getSports" },
  { method: "GET", path: "/matches", operationId: "getScraperMatches" },
  { method: "GET", path: "/live", operationId: "getLive" },
  { method: "GET", path: "/matches/{matchId}", operationId: "getMatchDetail" },
  { method: "GET", path: "/matches/{matchId}/statistics", operationId: "getMatchStatistics" },
  { method: "GET", path: "/matches/{matchId}/snapshots", operationId: "getSnapshots" },
  { method: "GET", path: "/db/matches", operationId: "getDbMatches" },
  { method: "POST", path: "/cache/clear", operationId: "clearCache" },
  { method: "GET", path: "/test/scrape", operationId: "testScrape" },
];

interface MatchesQuery {
  sport?: number;
  scope?: string;
  enrich?: string | string[];
  filter?: string;
  geo?: string;
  workers?: number;
  refresh?: boolean;
}

interface MatchDetailQuery {
  sport?: number;
  enrich?: string | string[];
  geo?: string;
}

interface LiveQuery {
  sport?: number;
  enrich?: string | string[];
  geo?: string;
  workers?: number;
  refresh?: boolean;
}

interface StatisticsQuery {
  sport?: number;
}

const toList = (value: string | string[] | undefined): string[] => {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

const assertEnrich = (enrich: string[]): void => {
  const invalid = enrich.filter((e) => !service.ENRICH_CHOICES.includes(e as (typeof service.ENRICH_CHOICES)[number]));
  if (invalid.length > 0) {
    throw new ValidationError(`Valori enrich non validi: ${invalid.join(", ")}`);
  }
}

const assertSport = (sport: number): number => {
  if (!(sport in SPORTS)) {
    throw new ValidationError(`Sport non supportato: ${sport}`);
  }
  return sport;
}

export const scraperRoutes = (app: FastifyInstance): void => {
  app.get("/health", () => ({
    status: "ok",
    db: db.dbPath(),
    matches_stored: db.countMatches(),
  }));

  app.get("/sports", () => ({ sports: SPORTS }));

  app.get<{ Querystring: MatchesQuery }>(
    "/matches",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            sport: { type: "integer" },
            scope: { type: "string", enum: ["live", "today"] },
            enrich: { type: "array", items: { type: "string" } },
            filter: { type: "string" },
            geo: { type: "string" },
            workers: { type: "integer", minimum: 1, maximum: 32 },
            refresh: { type: "boolean" },
          },
        },
      },
    },
    async (request) => {
      const q = request.query;
      const enrich = toList(q.enrich);
      assertEnrich(enrich);
      const [matches, cached] = await service.getMatches(
        assertSport(q.sport ?? 1),
        q.scope ?? "live",
        q.filter ?? null,
        enrich,
        q.geo ?? "IT",
        q.workers ?? 8,
        q.refresh ?? false,
      );
      return { count: matches.length, cached, matches };
    },
  );

  app.get<{ Querystring: LiveQuery }>(
    "/live",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            sport: { type: "integer" },
            enrich: { type: "array", items: { type: "string" } },
            geo: { type: "string" },
            workers: { type: "integer", minimum: 1, maximum: 32 },
            refresh: { type: "boolean" },
          },
        },
      },
    },
    async (request) => {
      const q = request.query;
      const enrich = toList(q.enrich);
      assertEnrich(enrich);
      const [matches, cached] = await service.getLiveMatches(
        assertSport(q.sport ?? 1),
        enrich,
        q.geo ?? "IT",
        q.workers ?? 8,
        q.refresh ?? false,
      );
      return { count: matches.length, cached, matches };
    },
  );

  app.get<{ Params: { matchId: string }; Querystring: MatchDetailQuery }>(
    "/matches/:matchId",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            sport: { type: "integer" },
            enrich: { type: "array", items: { type: "string" } },
            geo: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const q = request.query;
      const enrich = q.enrich === undefined ? ["detail"] : toList(q.enrich);
      assertEnrich(enrich);
      const match = await service.getMatch(request.params.matchId, assertSport(q.sport ?? 1), enrich, q.geo ?? "IT");
      if (match === null) {
        return reply.code(404).send({ detail: "Partita non trovata" });
      }
      return match;
    },
  );

  app.get<{ Params: { matchId: string }; Querystring: StatisticsQuery }>(
    "/matches/:matchId/statistics",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            sport: { type: "integer" },
          },
        },
      },
    },
    async (request) => {
      assertSport(request.query.sport ?? 1);
      const statistics = await service.getMatchStatistics(request.params.matchId);
      return { match_id: request.params.matchId, statistics };
    },
  );

  app.get<{ Params: { matchId: string }; Querystring: { limit?: number } }>(
    "/matches/:matchId/snapshots",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { limit: { type: "integer", minimum: 1, maximum: 2000 } },
        },
      },
    },
    (request) => db.getSnapshots(request.params.matchId, request.query.limit ?? 200),
  );

  app.get<{
    Querystring: { sport?: number; scope?: string; filter?: string; limit?: number };
  }>(
    "/db/matches",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            sport: { type: "integer" },
            scope: { type: "string", enum: ["live", "today"] },
            filter: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 5000 },
          },
        },
      },
    },
    (request) => {
      const q = request.query;
      const sport = q.sport === undefined ? null : assertSport(q.sport);
      const matches = db.getMatches(sport, q.scope ?? "live", q.filter ?? null, q.limit ?? 500);
      return { count: matches.length, cached: true, matches };
    },
  );

  app.post("/cache/clear", () => {
    service.clearCache();
    return { status: "cleared" };
  });

  app.get<{ Querystring: { sport?: number; scope?: string; sample?: number } }>(
    "/test/scrape",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            sport: { type: "integer" },
            scope: { type: "string", enum: ["live", "today"] },
            sample: { type: "integer", minimum: 0, maximum: 20 },
          },
        },
      },
    },
    async (request) => {
      const q = request.query;
      const sport = assertSport(q.sport ?? 1);
      return service.testScrape(sport, q.scope ?? "live", q.sample ?? 3);
    },
  );
}
