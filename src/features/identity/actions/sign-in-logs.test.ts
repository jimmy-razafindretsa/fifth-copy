import { beforeEach, describe, expect, it, vi } from "vitest";

// #87 C4: the sign-in action, with an email-shaped username, logs nothing that carries it, whatever the
// outcome (the static half of the guard: src/server/auth/no-email.test.ts).
const s = vi.hoisted(() => ({
  logs: [] as unknown[][],
  lookup: "miss" as "miss" | "throw" | "hit",
}));
vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NODE_ENV: "test", AUTH_SECRET: "e".repeat(32) } }));
vi.mock("@/server/logger", () => ({
  logger: new Proxy(
    {},
    {
      get:
        (_t, level) =>
        (...args: unknown[]) =>
          s.logs.push([level, ...args]),
    },
  ),
}));
vi.mock("@/i18n", async () => {
  const { en } = await import("@/i18n/en");
  const { fill } = await import("@/i18n/format");
  return { fill, getT: async () => en };
});
vi.mock("@/server/auth", () => ({
  verifyCredentials: async () => {
    if (s.lookup === "throw") throw new Error("lookup failed for ada@example.test");
    return s.lookup === "hit" ? { id: "u1", name: "Ada", tokenVersion: 0 } : null;
  },
  signIn: async () => {
    throw new Error("CredentialsSignin ada@example.test");
  },
}));
vi.mock("@/server/limiter", () => ({
  requestSubject: async () => "ip:203.0.113.5",
  limit: async () => ({ ok: true, retryAfterMs: 0 }),
}));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("../merge/merge-on-sign-in", () => ({ mergeGuestCookieInto: vi.fn() }));
vi.mock("../preferences/cookies", () => ({ refreshPreferenceCookies: vi.fn() }));

describe("sign-in never logs an email-shaped username (#87 C4)", () => {
  beforeEach(() => {
    s.logs = [];
  });

  it.each(["miss", "throw", "hit"] as const)("lookup %s", async (lookup) => {
    s.lookup = lookup;
    const { signIn } = await import("./sign-in");
    const form = new FormData();
    form.set("username", "ada@example.test");
    form.set("password", "correct horse");
    await signIn(form).catch(() => undefined);
    const logged = JSON.stringify(s.logs, (_k, v: unknown) =>
      v instanceof Error ? `${v.name}: ${v.message}` : v,
    );
    expect(logged).not.toMatch(/ada@example\.test|ada%40/i);
    if (lookup !== "miss") expect(s.logs.length).toBeGreaterThan(0); // the failure paths do log
  });
});
