import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { getSettings } from "./config.ts";
import { ConflictError, ValidationError, baseResponse } from "./errors.ts";
import { sbiRoutes } from "./sbi/routes.ts";
import { scraperRoutes } from "./scraper/routes.ts";
import { initDb } from "./scraper/db.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = resolve(HERE, "..", "openapi", "openapi.yaml");

export async function buildServer(): Promise<FastifyInstance> {
  const settings = getSettings();
  const app = Fastify({
    logger: { level: settings.logLevel },
  });

  initDb();

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ConflictError) {
      return reply.code(409).send(baseResponse(error.message, 409));
    }
    if (error instanceof ValidationError) {
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
    specification: { path: CONTRACT_PATH, baseDir: resolve(HERE, "..") },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/openapi.json", () => app.swagger());

  app.register(sbiRoutes);
  app.register(scraperRoutes);

  return app;
}
