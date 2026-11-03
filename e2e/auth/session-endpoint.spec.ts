import { randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import type { APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import { expect, test } from "../fixtures";

// Contract C4 + C5 of #786: the Auth.js routes under /api/auth over the real web server. There is no
// sign-in screen yet (#36), so the credentials callback is driven the way its form posts it. The account
// is seeded into the database the web server reads (DATABASE_URL: the card's own DB in a worktree, the
// test DB in CI), with an Argon2id hash computed here (same algorithm as src/server/auth/password.ts).

/** Auth.js's session cookie over http (the `__Secure-` prefix applies on https only). */
const SESSION_COOKIE = "authjs.session-token";
const PASSWORD = `pw-${randomBytes(8).toString("hex")}`;

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

async function csrfToken(request: APIRequestContext): Promise<string> {
  const res = await request.get("/api/auth/csrf");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { csrfToken?: unknown };
  expect(typeof body.csrfToken).toBe("string");
  return body.csrfToken as string;
}

async function postCredentials(request: APIRequestContext, username: string, password: string) {
  const token = await csrfToken(request);
  return request.post("/api/auth/callback/credentials", {
    form: { csrfToken: token, username, password, callbackUrl: "/" },
    maxRedirects: 0,
  });
}

async function sessionCookie(request: APIRequestContext) {
  const { cookies } = await request.storageState();
  return cookies.find((c) => c.name.endsWith(SESSION_COOKIE));
}

test.describe("Auth.js endpoints (#786)", () => {
  // One project is enough: these are JSON endpoints with no layout.
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only");

  test("C4 session is {} when signed out, providers lists credentials, csrf returns a token", async ({
    request,
  }) => {
    const session = await request.get("/api/auth/session");
    expect(session.status()).toBe(200);
    expect(await session.json()).toEqual({});

    const providers = await request.get("/api/auth/providers");
    expect(providers.status()).toBe(200);
    expect(Object.keys(await providers.json())).toEqual(["credentials"]);

    expect((await csrfToken(request)).length).toBeGreaterThan(16);
  });

  test.describe("C5 credentials callback", () => {
    const username = `e2e-auth-${randomBytes(4).toString("hex")}`;
    const typistName = `E2E-Auth-${randomBytes(4).toString("hex")}`;

    test.beforeAll(async () => {
      const passwordHash = await hash(PASSWORD, {
        algorithm: 2, // Argon2id
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      await withDb((db) =>
        db.query(
          `INSERT INTO "User" (id, "isGuest", "typistName", username, "usernameNormalized", "passwordHash")
           VALUES ($1, false, $2, $3, $3, $4)`,
          [`e2e_${randomBytes(8).toString("hex")}`, typistName, username, passwordHash],
        ),
      );
    });

    test.afterAll(async () => {
      await withDb((db) => db.query(`DELETE FROM "User" WHERE "typistName" = $1`, [typistName]));
    });

    test("the right password sets the session cookie and the session names the typist", async ({
      request,
    }) => {
      const res = await postCredentials(request, username, PASSWORD);
      expect(res.status()).toBe(302);
      expect(await sessionCookie(request), "session cookie").toBeDefined();

      const session = await request.get("/api/auth/session");
      expect(session.status()).toBe(200);
      const body = (await session.json()) as { user?: Record<string, unknown> };
      expect(body.user).toEqual({ id: expect.any(String), name: typistName, tokenVersion: 0 });
    });

    test("the wrong password sets no session cookie and the session stays {}", async ({
      request,
    }) => {
      const res = await postCredentials(request, username, `${PASSWORD}-wrong`);
      expect(res.status()).toBe(302);
      expect(res.headers()["location"]).toContain("error=CredentialsSignin");
      expect(await sessionCookie(request), "session cookie").toBeUndefined();

      const session = await request.get("/api/auth/session");
      expect(await session.json()).toEqual({});
    });
  });
});
