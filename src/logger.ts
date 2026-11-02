import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { threadId } from "node:worker_threads";
import pino, { type Logger } from "pino";
import { getSettings } from "./config.ts";

/**
 * Contextual fields attached to every log line, mirroring the logback MDC.
 *
 * `fixtureId` is the SBI fixture id when available. In the live scraper flow we
 * currently use the diretta.it match id as the fixture id.
 */
export interface LogContext {
  traceId?: string;
  strategy?: string;
  match?: string;
  fixtureId?: string;
}

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

const storage = new AsyncLocalStorage<LogContext>();

export const getLogContext = (): LogContext => storage.getStore() ?? {};

/**
 * Runs `fn` with the given context merged on top of the current one.
 *
 * A trace id is generated when the context has none, so every standalone
 * strategy/cron run can be followed end to end.
 */
export const runWithLogContext = <T>(context: LogContext, fn: () => T): T => {
  const merged: LogContext = { ...getLogContext(), ...context };
  if (merged.traceId === undefined || merged.traceId === "") {
    merged.traceId = randomUUID();
  }
  return storage.run(merged, fn);
};

type LogRecord = Record<string, unknown>;
type LogFormatter = (entry: LogRecord) => string;

const CONTEXT_KEYS = new Set(["level", "time", "msg", "traceId", "strategy", "match", "fixtureId", "reqId"]);

const LEVEL_LABELS: Record<number, string> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARN",
  50: "ERROR",
  60: "FATAL",
};

const levelLabel = (level: unknown): string => {
  const numeric = typeof level === "number" ? level : Number.NaN;
  return (LEVEL_LABELS[numeric] ?? String(level ?? "INFO")).padEnd(5);
};

const threadName = (): string => (threadId === 0 ? "main" : `worker:${threadId}`);

const text = (value: unknown, fallback = "-"): string => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return String(value);
};

const message = (value: unknown): string => (typeof value === "string" ? value : "");

const extras = (entry: LogRecord): string => {
  const rest: LogRecord = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!CONTEXT_KEYS.has(key)) {
      rest[key] = value;
    }
  }
  return Object.keys(rest).length === 0 ? "" : ` ${JSON.stringify(rest)}`;
};

const formatConsole: LogFormatter = (entry) =>
  `[ ${levelLabel(entry["level"])} ] | ${threadName()} | ${text(entry["traceId"])} | ${message(entry["msg"])}${extras(entry)}\n`;

const formatStrategy: LogFormatter = (entry) =>
  `[ ${levelLabel(entry["level"])} ] | ${text(entry["traceId"])} | ${text(entry["strategy"])} | ${text(entry["match"])} | ${text(entry["fixtureId"])} | ${message(entry["msg"])}${extras(entry)}\n`;

const createDestination = (format: LogFormatter): Writable =>
  new Writable({
    write(chunk, _encoding, callback) {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim() === "") {
          continue;
        }
        try {
          process.stdout.write(format(JSON.parse(line) as LogRecord));
        } catch {
          process.stdout.write(`${line}\n`);
        }
      }
      callback();
    },
  });

const loggerOptions = () => ({
  level: getSettings().logLevel,
  base: null,
  timestamp: false,
  mixin: () => ({ ...getLogContext() }),
});

let consoleLogger: Logger | null = null;
let strategyLogger: Logger | null = null;

/**
 * Process-wide logger for the default console appender. Code paths running
 * outside an HTTP request (scripts, direct service calls) use this one.
 */
export const getLogger = (): Logger => {
  if (consoleLogger === null) {
    consoleLogger = pino(loggerOptions(), createDestination(formatConsole));
  }
  return consoleLogger;
};

/**
 * Dedicated strategy logger: it does not propagate to the root console
 * logger (logback `additivity="false"`), it writes the strategy pattern with
 * traceId, strategy, match and fixtureId.
 */
export const getStrategyLogger = (): Logger => {
  if (strategyLogger === null) {
    strategyLogger = pino(loggerOptions(), createDestination(formatStrategy));
  }
  return strategyLogger;
};
