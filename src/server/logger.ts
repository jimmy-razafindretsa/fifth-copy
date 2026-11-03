import "server-only";
import { env } from "@/env";

/**
 * The web app's structured logger (ARCHITECTURE 10): one JSON line per event, with secret-looking
 * fields redacted. Same line shape as src/server/limiter and src/server/internal-api; a pino swap keeps
 * this interface. Fields are flat scalars so a caller cannot pass a request body through by accident.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | null | undefined>;

const REDACT = /pass|secret|token|cookie|authorization|hash|credential|email/i;
const SINK: Record<LogLevel, (line: string) => void> = {
  debug: (line) => console.debug(line),
  info: (line) => console.info(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

/** Replaces the value of every field whose name looks secret with "[redacted]". */
export function redact(fields: LogFields): LogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, REDACT.test(key) ? "[redacted]" : value]),
  );
}

function write(level: LogLevel, msg: string, fields: LogFields = {}) {
  // debug lines are for local development only.
  if (level === "debug" && env.NODE_ENV !== "development") return;
  SINK[level](JSON.stringify({ level, time: new Date().toISOString(), msg, ...redact(fields) }));
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};
export type Logger = typeof logger;
