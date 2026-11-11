import type { FastifyInstance } from "fastify";
import type { RouteMetadata } from "../bet-api/routes.ts";
import * as service from "./service.ts";
import * as syncService from "../services/sync-service.ts";

export const MAPPING_ROUTES: readonly RouteMetadata[] = [
  { method: "POST", path: "/mapping/leagues/auto-sync", operationId: "autoSyncLeagues" },
  { method: "GET", path: "/mapping/diretta/tournaments", operationId: "listDirettaTournaments" },
  { method: "GET", path: "/mapping/diretta/teams", operationId: "getDirettaTeams" },
];

export const mappingRoutes = (app: FastifyInstance): void => {
  app.post(
    "/mapping/leagues/auto-sync",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            dryRun: { type: "boolean" },
            apply: { type: "boolean" },
            season: { type: "integer", minimum: 1800 },
            runTeamsSync: { type: "boolean" },
            runSeasonSync: { type: "boolean" },
          },
        },
      },
    },
    (request) => service.autoSyncLeaguesFromMonitoring((request.body as Record<string, unknown>) ?? {}),
  );

  app.post(
    "/mapping/sync",
    {
      schema: {
        body: {
          type: "object",
          required: ["leagues"],
          properties: {
            leagues: {
              type: "array",
              items: {
                type: "object",
                required: ["leagueId", "tournamentId"],
                properties: {
                  leagueId: { type: "integer" },
                  tournamentId: { type: "string" },
                },
              },
            },
            season: { type: "string" },
          },
        },
      },
    },
    async (request) => {
      const body = (request.body as { leagues: { leagueId: number; tournamentId: string }[]; season?: string }) ?? { leagues: [] };
      return syncService.runSync(body.leagues, body.season);
    },
  );

  app.get(
    "/mapping/diretta/tournaments",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { filter: { type: "string" } },
        },
      },
    },
    async (request) => {
      const q = request.query as { filter?: string };
      return syncService.listDirettaTournaments(q?.filter);
    },
  );
  app.get(
    "/mapping/diretta/teams",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["tournamentId"],
          properties: { tournamentId: { type: "string" } },
        },
      },
    },
    async (request) => {
      const q = request.query as { tournamentId: string };
      return syncService.getDirettaTeams(q.tournamentId);
    },
  );
};
