import { z } from "zod";

/** The only place in the race server that reads process.env. Prints variable names on error, never values. */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  RACE_SERVER_PORT: z.coerce.number().int().positive().default(4000),
});

export type RaceServerEnv = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): RaceServerEnv {
  const result = schema.safeParse({
    NODE_ENV: source.NODE_ENV,
    RACE_SERVER_PORT: source.RACE_SERVER_PORT,
  });
  if (!result.success) {
    const names = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`race-server: invalid environment variables: ${names}. See .env.example.`);
  }
  return result.data;
}
