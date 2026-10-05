import "server-only";
import { z } from "zod";

/**
 * The only place that reads process.env (see AGENTS.md, Next.js hazards).
 * Browser-exposed values must be prefixed NEXT_PUBLIC_ and declared in `client`.
 */
const server = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  // Signs the guest cookie (src/server/auth/guest-cookie.ts) and, later, Auth.js sessions.
  AUTH_SECRET: z.string().min(32),
});

const client = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
});

const schema = server.extend(client.shape);

function parse() {
  const result = schema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
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
