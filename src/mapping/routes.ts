import type { FastifyInstance } from "fastify";
import * as service from "./service.ts";
import {
  MAPPING_SOURCES,
  MAPPING_STATUSES,
  PROVIDERS,
  type CreateTeamInput,
  type Provider,
  type SyncSeasonInput,
  type UpsertFixtureLinkInput,
  type UpsertMappingInput,
} from "./models.ts";

interface ResolveTeamQuery {
  provider: Provider;
  providerTeamId?: string;
  name?: string;
  country?: string;
  autoLink?: boolean;
}

interface StatusBody {
  status: string;
}

interface FixtureQuery {
  date: string;
  homeTeamId: string;
  awayTeamId: string;
}

const providerSchema = { type: "string", enum: PROVIDERS } as const;
const statusSchema = { type: "string", enum: MAPPING_STATUSES } as const;

export const mappingRoutes = (app: FastifyInstance): void => {
  app.get("/mapping/teams", () => service.listTeams());

  app.post<{ Body: CreateTeamInput }>(
    "/mapping/teams",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1 },
            country: { type: ["string", "null"] },
            aliases: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const team = await service.createTeam(request.body);
      return reply.code(201).send(team);
    },
  );

  app.get<{ Querystring: ResolveTeamQuery }>(
    "/mapping/teams/resolve",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["provider"],
          properties: {
            provider: providerSchema,
            providerTeamId: { type: "string" },
            name: { type: "string" },
            country: { type: "string" },
            autoLink: { type: "boolean" },
          },
        },
      },
    },
    (request) => service.resolveTeam(request.query),
  );

  app.get<{ Params: { teamId: string } }>(
    "/mapping/teams/:teamId/aliases",
    (request) => service.listAliases(request.params.teamId),
  );

  app.post<{ Params: { teamId: string }; Body: { alias: string; source?: string } }>(
    "/mapping/teams/:teamId/aliases",
    {
      schema: {
        body: {
          type: "object",
          required: ["alias"],
          properties: {
            alias: { type: "string", minLength: 1 },
            source: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const alias = await service.addAlias(request.params.teamId, request.body.alias, request.body.source);
      return reply.code(201).send(alias);
    },
  );

  app.get<{ Querystring: { status?: string } }>(
    "/mapping/mappings",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { status: statusSchema },
        },
      },
    },
    (request) => service.listMappings(request.query.status),
  );

  app.put<{ Body: UpsertMappingInput }>(
    "/mapping/mappings",
    {
      schema: {
        body: {
          type: "object",
          required: ["teamId", "provider", "providerTeamId"],
          properties: {
            teamId: { type: "string", minLength: 1 },
            provider: providerSchema,
            providerTeamId: { type: "string", minLength: 1 },
            rawName: { type: "string" },
            country: { type: ["string", "null"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            status: statusSchema,
            source: { type: "string", enum: MAPPING_SOURCES },
          },
        },
      },
    },
    (request) => service.upsertMapping(request.body),
  );

  app.post<{ Params: { mappingId: string }; Body: StatusBody }>(
    "/mapping/mappings/:mappingId/status",
    {
      schema: {
        body: {
          type: "object",
          required: ["status"],
          properties: { status: statusSchema },
        },
      },
    },
    (request) => service.setMappingStatus(request.params.mappingId, request.body.status),
  );

  app.post<{ Body: SyncSeasonInput }>(
    "/mapping/seasons/sync",
    {
      schema: {
        body: {
          type: "object",
          required: ["leagueId"],
          properties: {
            leagueId: { type: "integer", minimum: 1 },
            season: { type: "integer", minimum: 1800 },
            direttaTournamentId: { type: "string" },
            dryRun: { type: "boolean" },
            maxFixtures: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    (request) => service.syncSeason(request.body),
  );

  app.put<{ Body: UpsertFixtureLinkInput }>(
    "/mapping/fixtures",
    {
      schema: {
        body: {
          type: "object",
          required: ["matchDate", "homeTeamId", "awayTeamId"],
          properties: {
            matchDate: { type: "string" },
            homeTeamId: { type: "string", minLength: 1 },
            awayTeamId: { type: "string", minLength: 1 },
            direttaMatchId: { type: ["string", "null"] },
            apiFootballFixtureId: { type: ["string", "null"] },
            kickoffAt: { type: ["string", "null"] },
          },
        },
      },
    },
    async (request, reply) => {
      const fixture = await service.upsertFixtureLink(request.body);
      return reply.code(201).send(fixture);
    },
  );

  app.get<{ Querystring: FixtureQuery }>(
    "/mapping/fixtures/resolve",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["date", "homeTeamId", "awayTeamId"],
          properties: {
            date: { type: "string" },
            homeTeamId: { type: "string", minLength: 1 },
            awayTeamId: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const fixture = await service.resolveFixture(
        request.query.date,
        request.query.homeTeamId,
        request.query.awayTeamId,
      );
      if (!fixture) {
        return reply.code(404).send({ detail: "Fixture link non trovato" });
      }
      return fixture;
    },
  );
};
