import { z } from "zod";

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
});

export type RaceServerEnv = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): RaceServerEnv {
  const result = schema.safeParse({
    NODE_ENV: source.NODE_ENV,
    RACE_SERVER_PORT: source.RACE_SERVER_PORT,
    REDIS_URL: source.REDIS_URL,
    RACE_TOKEN_SECRET: source.RACE_TOKEN_SECRET,
    WEB_ORIGIN: source.WEB_ORIGIN,
  });
  if (!result.success) {
    const names = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`race-server: invalid environment variables: ${names}. See .env.example.`);
  }
  return result.data;
}
