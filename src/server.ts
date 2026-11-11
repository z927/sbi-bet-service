import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { getSettings } from "./config.ts";
import { ConflictError, ValidationError, baseResponse } from "./errors.ts";
import { sbiRoutes } from "./bet-api/routes.ts";
import { mappingRoutes } from "./mapping/routes.ts";
import { initDb } from "./scraper/db.ts";
import { getLogger, runWithLogContext } from "./logger.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = resolve(HERE, "..", "openapi", "openapi.yaml");

export const buildServer = async (): Promise<FastifyInstance> => {
  const settings = getSettings();
  const app = Fastify({
    loggerInstance: getLogger(),
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: (request) => {
      const header = request.headers["x-request-id"];
      const value = Array.isArray(header) ? header[0] : header;
      return value !== undefined && value.trim() !== "" ? value.trim() : randomUUID();
    },
  });

  app.addHook("onRequest", (request, _reply, done) => {
    runWithLogContext({ traceId: String(request.id) }, () => {
      request.log.info({ method: request.method, url: request.url }, "incoming request");
      done();
    });
  });

  app.addHook("onResponse", (request, reply, done) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      "request completed",
    );
    done();
  });

  initDb();

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ConflictError) {
      request.log.warn({ err: error }, "conflict");
      return reply.code(409).send(baseResponse(error.message, 409));
    }
    if (error instanceof ValidationError) {
      request.log.warn({ err: error }, "validation error");
      return reply.code(422).send({ detail: error.message });
    }
    if (error.validation) {
      return reply.code(422).send({ detail: error.message });
    }
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ detail: error.message });
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send(baseResponse("Internal Server Error", 500));
  });

  await app.register(swagger, {
    mode: "static",
    specification: {
      path: CONTRACT_PATH,
      baseDir: resolve(HERE, ".."),
      postProcessor: (document) => ({
        ...document,
        info: { ...document.info, version: settings.appVersion },
      }),
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/openapi.json", () => app.swagger());

  app.register(sbiRoutes);
  app.register(mappingRoutes);

  return app as unknown as FastifyInstance;
}
