import { randomBytes } from "node:crypto";
import type { NextAuthConfig } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #786 C1 + C3: the Auth.js config, its JWT/session callbacks and the Credentials `authorize`.
// No DB and no real env here: the adapter's Prisma calls are covered by adapter.test.ts.
const secret = vi.hoisted(() => ({ value: "" }));
const verifyCredentials = vi.hoisted(() => vi.fn());
vi.mock("@/env", () => {
  secret.value = randomBytes(32).toString("hex");
  return { env: { AUTH_SECRET: secret.value, NODE_ENV: "test" } };
});
vi.mock("@/server/db", () => ({ db: {} }));
vi.mock("./credentials", () => ({ verifyCredentials }));

const { authConfig: config, authorizeCredentials } = await import("./auth");
const authConfig: NextAuthConfig = config;

type JwtCallback = NonNullable<NonNullable<typeof authConfig.callbacks>["jwt"]>;
type SessionCallback = NonNullable<NonNullable<typeof authConfig.callbacks>["session"]>;
const jwt = authConfig.callbacks!.jwt as JwtCallback;
const session = authConfig.callbacks!.session as SessionCallback;

describe("authConfig (C1)", () => {
  it("uses the JWT strategy for 30 days", () => {
    expect(authConfig.session).toEqual({ strategy: "jwt", maxAge: 2592000 });
  });

  it("takes its secret from @/env, trusts the proxy host and keeps debug off", () => {
    expect(authConfig.secret).toBe(secret.value);
    expect(authConfig.trustHost).toBe(true);
    expect(authConfig.debug).toBeFalsy();
  });

  it("lists exactly the Credentials provider", () => {
    const providers = authConfig.providers.map((p) => (typeof p === "function" ? p() : p));
    expect(providers.map((p) => p.id)).toEqual(["credentials"]);
  });

  it("has an adapter that refuses email lookups", async () => {
    await expect(authConfig.adapter!.getUserByEmail!("a@example.test")).rejects.toMatchObject({
      name: "Unsupported",
    });
  });
});

describe("jwt callback (C1)", () => {
  it("copies exactly sub, name and tokenVersion from the user on sign-in", async () => {
    const token = await jwt({
      token: { sub: "u1", name: "Ada", email: "ada@example.test", picture: "https://p.test/a" },
      user: {
        id: "u1",
        name: "Ada",
        tokenVersion: 3,
        email: "ada@example.test",
        image: "https://p.test/a",
      },
      account: null,
      trigger: "signIn",
    });
    expect(token).toEqual({ sub: "u1", name: "Ada", tokenVersion: 3 });
  });

  it("returns the token unchanged on later reads", async () => {
    const stored = { sub: "u1", name: "Ada", tokenVersion: 3, iat: 1, exp: 2, jti: "j" };
    await expect(Promise.resolve(jwt({ token: stored, account: null } as never))).resolves.toEqual(
      stored,
    );
  });
});

describe("session callback (C1)", () => {
  it("exposes exactly { id, name, tokenVersion } on session.user", async () => {
    const expires = new Date(Date.now() + 1000).toISOString();
    const result = await session({
      session: {
        user: { name: "Ada", email: "ada@example.test", image: "https://p.test/a" },
        expires,
      },
      token: { sub: "u1", name: "Ada", tokenVersion: 3, email: "ada@example.test" },
    } as never);
    expect(result.user).toEqual({ id: "u1", name: "Ada", tokenVersion: 3 });
    expect(Object.keys(result).sort()).toEqual(["expires", "user"]);
    expect(result.expires).toBe(expires);
  });
});

describe("Credentials authorize (C3)", () => {
  beforeEach(() => verifyCredentials.mockReset());

  it("is the provider's authorize", () => {
    const [provider] = authConfig.providers as unknown as { options: { authorize: unknown } }[];
    expect(provider!.options.authorize).toBe(authorizeCredentials);
  });

  it("delegates once to verifyCredentials with the submitted username and password", async () => {
    verifyCredentials.mockResolvedValueOnce({ id: "u1", name: "Ada", tokenVersion: 0 });
    const user = await authorizeCredentials(
      { username: "Ada", password: "correct horse", csrfToken: "x", callbackUrl: "/" },
      new Request("http://localhost/api/auth/callback/credentials"),
    );
    expect(verifyCredentials).toHaveBeenCalledTimes(1);
    expect(verifyCredentials).toHaveBeenCalledWith({ username: "Ada", password: "correct horse" });
    expect(user).toEqual({ id: "u1", name: "Ada", tokenVersion: 0 });
  });

  it("returns null, without throwing, when verifyCredentials does", async () => {
    verifyCredentials.mockResolvedValueOnce(null);
    await expect(
      authorizeCredentials(
        { username: "nobody", password: "wrong" },
        new Request("http://localhost/api/auth/callback/credentials"),
      ),
    ).resolves.toBeNull();
    expect(verifyCredentials).toHaveBeenCalledTimes(1);
  });
});
