import { z } from "zod";

/**
 * Longest drain after SIGTERM, in s (#704): the longest timed race (600 s, `timerS` max), its
 * countdown and the results, with margin. Railway's draining time must be longer (railway.json).
 */
export const DEFAULT_DRAIN_CAP_S = 900;

/** The only place in the race server that reads process.env. Prints variable names on error, never values. */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  RACE_SERVER_PORT: z.coerce.number().int().positive().default(4000),
  /** Ephemeral room state only (ADR 0008). */
  REDIS_URL: z.url(),
  /** Verifies race tokens and the internal HMAC API (ADR 0006, 0009). Shared with the web app. */
  RACE_TOKEN_SECRET: z.string().min(32),
  /** Allowed Socket.IO CORS origin: the web app's public URL. */
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  /** e2e fast clock (ADR 0012): "1" divides every lifecycle duration by 10 (`rooms/durations.ts`). */
  RACE_FAST_CLOCK: z.enum(["0", "1"]).default("0"),
  /**
   * e2e only (#868): the reconnection grace of a line-cut desk in ms, in place of the table's (120 s, or
   * 12 s fast). Unset in production. Lets a spec wait a host's grace without the fast clock's other
   * durations (countdown, idle, auto start).
   */
  RACE_GRACE_MS: z.coerce.number().int().min(1_000).max(120_000).optional(),
  /** Drain cap after SIGTERM (#704): exit when no room is left or after this many seconds. */
  RACE_DRAIN_CAP_S: z.coerce.number().int().min(1).max(3600).default(DEFAULT_DRAIN_CAP_S),
  /** Railway's SIGTERM-to-SIGKILL time when set as a service variable (ADR 0019); boot warns if short. */
  RAILWAY_DEPLOYMENT_DRAINING_SECONDS: z.coerce.number().int().min(0).optional(),
});

export type RaceServerEnv = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): RaceServerEnv {
  const result = schema.safeParse({
    NODE_ENV: source.NODE_ENV,
    RACE_SERVER_PORT: source.RACE_SERVER_PORT,
    REDIS_URL: source.REDIS_URL,
    RACE_TOKEN_SECRET: source.RACE_TOKEN_SECRET,
    WEB_ORIGIN: source.WEB_ORIGIN,
    RACE_FAST_CLOCK: source.RACE_FAST_CLOCK,
    RACE_GRACE_MS: source.RACE_GRACE_MS || undefined,
    RACE_DRAIN_CAP_S: source.RACE_DRAIN_CAP_S,
    RAILWAY_DEPLOYMENT_DRAINING_SECONDS: source.RAILWAY_DEPLOYMENT_DRAINING_SECONDS,
  });
  if (!result.success) {
    const names = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`race-server: invalid environment variables: ${names}. See .env.example.`);
  }
  return result.data;
}

/** True when Railway would SIGKILL the drain before its cap (#704): the boot logs a warning. */
export function drainingTooShort(
  env: Pick<RaceServerEnv, "RACE_DRAIN_CAP_S" | "RAILWAY_DEPLOYMENT_DRAINING_SECONDS">,
): boolean {
  const draining = env.RAILWAY_DEPLOYMENT_DRAINING_SECONDS;
  return draining !== undefined && draining < env.RACE_DRAIN_CAP_S;
}
