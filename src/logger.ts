import pino from "pino";
import { getSettings } from "./config.ts";

/**
 * Minimal structured-logging surface shared by the service layer.
 *
 * Both the Fastify request logger (`FastifyBaseLogger`) and a standalone pino
 * instance satisfy it, so services can log without depending on Fastify.
 */
export interface AppLogger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

let instance: AppLogger | null = null;

/**
 * Process-wide logger for code paths that run outside an HTTP request
 * (scripts, direct service calls). The level follows LOG_LEVEL.
 */
export const getLogger = (): AppLogger => {
  if (instance === null) {
    instance = pino({ level: getSettings().logLevel });
  }
  return instance;
};
