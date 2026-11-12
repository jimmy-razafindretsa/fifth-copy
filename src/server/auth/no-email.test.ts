import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
      AUTH_GOOGLE_ID: "id",
      AUTH_GOOGLE_SECRET: "secret",
    }) as unknown as Array<{ id: string; options: { profile: (p: unknown) => unknown } }>;
    expect(providers.map((p) => p.id).sort()).toEqual(["discord", "github", "google"]);
    const raw = {
      id: "42",
      sub: "42",
      given_name: "Ada",
      picture: "https://lh3.example.test/42",
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

// The sign-in action's logs (src/server may not import a feature, so read as source): every logger call
// names the event only and never passes what was typed. Behaviour with an email-shaped username, for
// every outcome: src/features/identity/actions/sign-in-logs.test.ts.
describe("sign-in never logs the username (#87 C4)", () => {
  const source = readFileSync(
    join(process.cwd(), "src/features/identity/actions/sign-in.ts"),
    "utf8",
  );
  /** The argument text of every call to `logger.*(...)` or the local `failed(...)`. */
  const logCalls = [...source.matchAll(/\b(?:logger\.\w+|failed)\(([^)]*)\)/g)].map((m) => m[1]!);

  it("finds the action's log calls", () => {
    expect(logCalls.length).toBeGreaterThanOrEqual(3);
  });

  it("no log call carries the username, the password or the form", () => {
    for (const args of logCalls) {
      const code = args.replace(/"[^"]*"/g, '""'); // event names are fixed strings
      expect(code).not.toMatch(/\b(username|password|form|parsed)\b/);
    }
    // the helper logs a fixed name with empty fields
    expect(source).toMatch(/const failed = \(name: string\) => logger\.warn\(name, \{\}\);/);
  });
});
