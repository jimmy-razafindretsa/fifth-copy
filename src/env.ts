import "server-only";
import { z } from "zod";

/**
 * The only place that reads process.env (see AGENTS.md, Next.js hazards).
 * Browser-exposed values must be prefixed NEXT_PUBLIC_ and declared in `client`.
 */
const optionalSecret = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().min(1).optional(),
);

const server = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  /** Signs the guest cookie fc_guest (src/server/auth/guest-cookie.ts) and Auth.js session JWTs (src/server/auth/auth.ts), ADR 0009. */
  AUTH_SECRET: z.string().min(32),
  /** Signs race tokens and the internal HMAC API (ADR 0006, 0009). Shared with the race server. */
  RACE_TOKEN_SECRET: z.string().min(32),
  RACE_SERVER_INTERNAL_URL: z.url().default("http://localhost:4000"),
  /** Avatar files root (ADR 0014). Production mounts a volume at /data/avatars; locally a gitignored dir. */
  AVATAR_DIR: z.string().min(1).default(".data/avatars"),
  /** Avatar moderator (ADR 0015): the local heuristic, or the colour-driven fake for tests (never in production). */
  AVATAR_MODERATOR: z.enum(["heuristic", "fake"]).default("heuristic"),
  /**
   * The web's Redis (ADR 0020): the rate limiter (`src/server/limiter`, unreachable fails open) and
   * the internal-request nonce store (`src/server/internal-api/nonces.ts`, #716, fails closed).
   * Required in production; in development and test absent (or empty) disables both, one warning.
   */
  REDIS_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.url({ protocol: /^rediss?$/ }).optional(),
  ),
  /**
   * `off` turns the web rate limiter off while REDIS_URL stays set for the nonce store (#716):
   * Playwright runs the production build from one client IP (playwright.config.ts). Unset on Railway;
   * refused in production without `PLAYWRIGHT_E2E=1`.
   */
  WEB_RATE_LIMIT: z.enum(["on", "off"]).default("on"),
  /**
   * OAuth apps (ADR 0009, #49, Google #828): each provider is registered only when both its id and secret are set
   * (src/server/auth/providers.ts), so development without secrets runs; empty counts as unset.
   */
  AUTH_GITHUB_ID: optionalSecret,
  AUTH_GITHUB_SECRET: optionalSecret,
  AUTH_DISCORD_ID: optionalSecret,
  AUTH_DISCORD_SECRET: optionalSecret,
  AUTH_GOOGLE_ID: optionalSecret,
  AUTH_GOOGLE_SECRET: optionalSecret,
  /**
   * Railway's provided commit of the running deployment (ADR 0019, #718), shown by /api/health for the
   * deploy-check workflow; unset locally and in CI (health then reports `commit: null`).
   */
  RAILWAY_GIT_COMMIT_SHA: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().max(64).optional(),
  ),
  /** Set to `1` by playwright.config.ts only: the one run where a production build may take `WEB_RATE_LIMIT=off`. */
  PLAYWRIGHT_E2E: z.literal("1").optional(),
});

const client = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_RACE_SERVER_URL: z.url().default("http://localhost:4000"),
});

const schema = server.extend(client.shape).superRefine((value, ctx) => {
  // The fake approves, flags or rejects by colour: a production server must never run it.
  if (value.NODE_ENV === "production" && value.AVATAR_MODERATOR === "fake") {
    ctx.addIssue({
      code: "custom",
      path: ["AVATAR_MODERATOR"],
      message: "fake is not allowed in production",
    });
  }
  // The limiter's test switch is default-deny in production: only a Playwright run may set it.
  if (
    value.NODE_ENV === "production" &&
    value.WEB_RATE_LIMIT === "off" &&
    value.PLAYWRIGHT_E2E !== "1"
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["WEB_RATE_LIMIT"],
      message: "off is allowed in production only under Playwright",
    });
  }
  // The nonce store fails closed (ADR 0020 amendment, #716): a production web without Redis
  // refuses to boot rather than refusing every race server call.
  if (value.NODE_ENV === "production" && !value.REDIS_URL) {
    ctx.addIssue({ code: "custom", path: ["REDIS_URL"], message: "required in production" });
  }
});

function parse() {
  const result = schema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    RACE_TOKEN_SECRET: process.env.RACE_TOKEN_SECRET,
    RACE_SERVER_INTERNAL_URL: process.env.RACE_SERVER_INTERNAL_URL,
    AVATAR_DIR: process.env.AVATAR_DIR,
    AVATAR_MODERATOR: process.env.AVATAR_MODERATOR,
    REDIS_URL: process.env.REDIS_URL,
    WEB_RATE_LIMIT: process.env.WEB_RATE_LIMIT,
    PLAYWRIGHT_E2E: process.env.PLAYWRIGHT_E2E,
    RAILWAY_GIT_COMMIT_SHA: process.env.RAILWAY_GIT_COMMIT_SHA,
    AUTH_GITHUB_ID: process.env.AUTH_GITHUB_ID,
    AUTH_GITHUB_SECRET: process.env.AUTH_GITHUB_SECRET,
    AUTH_DISCORD_ID: process.env.AUTH_DISCORD_ID,
    AUTH_DISCORD_SECRET: process.env.AUTH_DISCORD_SECRET,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
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
