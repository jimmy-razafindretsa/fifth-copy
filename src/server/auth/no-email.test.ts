import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { oauthProviders } from "./providers";

// #87 C4, ADR 0009 "no email is ever stored": a guard that fails the build if an email can enter the
// system unnoticed: a Prisma field named like one, a provider profile() that hands Auth.js an `email`,
// or the sign-in action logging what a person typed as their username (an address, for instance).
const EMAIL = /email/i;

/** Every `model` block's field names in prisma/schema/*.prisma. */
function prismaFields(): Array<{ model: string; field: string }> {
  const dir = join(process.cwd(), "prisma/schema");
  const fields: Array<{ model: string; field: string }> = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".prisma"))) {
    let model: string | null = null;
    for (const raw of readFileSync(join(dir, file), "utf8").split("\n")) {
      const line = raw.replace(/\/\/.*$/, "").trim();
      const open = /^(model|type|view)\s+(\w+)\s*\{/.exec(line);
      if (open) model = open[2]!;
      else if (line === "}") model = null;
      else if (model && /^\w/.test(line) && !line.startsWith("@@")) {
        fields.push({ model, field: line.split(/\s+/)[0]! });
      }
    }
  }
  return fields;
}

describe("no-email guard (#87 C4)", () => {
  it("no Prisma model has a field named like an email", () => {
    const fields = prismaFields();
    expect(fields.length).toBeGreaterThan(20); // the parser sees the schema
    expect(fields.filter(({ field }) => EMAIL.test(field))).toEqual([]);
  });

  it("the guard catches an email field", () => {
    expect(EMAIL.test("contactEmail")).toBe(true);
  });

  it("no provider profile() hands Auth.js an email", async () => {
    const providers = oauthProviders({
      AUTH_GITHUB_ID: "id",
      AUTH_GITHUB_SECRET: "secret",
      AUTH_DISCORD_ID: "id",
      AUTH_DISCORD_SECRET: "secret",
    }) as unknown as Array<{ id: string; options: { profile: (p: unknown) => unknown } }>;
    expect(providers.map((p) => p.id).sort()).toEqual(["discord", "github"]);
    const raw = {
      id: "42",
      login: "ada",
      username: "ada",
      name: "Ada Lovelace",
      email: "ada@example.test",
      verified: true,
      avatar_url: "https://avatars.example.test/42",
      avatar: "abc",
    };
    for (const provider of providers) {
      const user = (await provider.options.profile(raw)) as Record<string, unknown>;
      expect(
        Object.keys(user).filter((k) => EMAIL.test(k)),
        provider.id,
      ).toEqual([]);
      expect(JSON.stringify(user), provider.id).not.toContain('example.test"');
      expect(JSON.stringify(user), provider.id).not.toContain("ada@");
    }
  });
});

// The sign-in action's every outcome, with an email-shaped username: nothing logged may carry it.
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
vi.mock("@/features/identity/merge/merge-on-sign-in", () => ({ mergeGuestCookieInto: vi.fn() }));
vi.mock("@/features/identity/preferences/cookies", () => ({ refreshPreferenceCookies: vi.fn() }));

describe("sign-in never logs an email-shaped username (#87 C4)", () => {
  beforeEach(() => {
    s.logs = [];
  });

  it.each(["miss", "throw", "hit"] as const)("lookup %s", async (lookup) => {
    s.lookup = lookup;
    const { signIn } = await import("@/features/identity/actions/sign-in");
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
