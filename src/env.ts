import "server-only";
import { z } from "zod";

/**
 * The only place that reads process.env (see AGENTS.md, Next.js hazards).
 * Browser-exposed values must be prefixed NEXT_PUBLIC_ and declared in `client`.
 */
const server = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  /** Signs the guest cookie fc_guest (src/server/auth/guest-cookie.ts, ADR 0009) and, later, Auth.js sessions. */
  AUTH_SECRET: z.string().min(32),
  /** Signs race tokens and the internal HMAC API (ADR 0006, 0009). Shared with the race server. */
  RACE_TOKEN_SECRET: z.string().min(32),
  RACE_SERVER_INTERNAL_URL: z.url().default("http://localhost:4000"),
});

const client = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_RACE_SERVER_URL: z.url().default("http://localhost:4000"),
});

const schema = server.extend(client.shape);

function parse() {
  const result = schema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    RACE_TOKEN_SECRET: process.env.RACE_TOKEN_SECRET,
    RACE_SERVER_INTERNAL_URL: process.env.RACE_SERVER_INTERNAL_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_RACE_SERVER_URL: process.env.NEXT_PUBLIC_RACE_SERVER_URL,
  });
  if (!result.success) {
    // Print variable names only, never values.
    const names = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment variables: ${names}. See .env.example.`);
  }
  return result.data;
}

export const env = parse();
export type Env = z.infer<typeof schema>;
