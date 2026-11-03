import { createHmac, randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { Client } from "pg";
import { expect, test } from "../fixtures";

// Contract C4 of #787: the whole session chain over the real web server. An account signs in with the
// credentials callback form POST (there is no sign-in screen yet, #36); /api/auth/session and the landing
// header's docket (src/features/landing/components/landing-header.tsx, via getViewer) name the account,
// although the browser also carries a valid fc_guest cookie; after a direct tokenVersion bump the same
// session cookie yields {} and the docket falls back to the guest. Rows are seeded into the DB the web
// server reads (DATABASE_URL), like e2e/auth/session-endpoint.spec.ts.

const SESSION_COOKIE = "authjs.session-token"; // http: no __Secure- prefix
const PASSWORD = `pw-${randomBytes(8).toString("hex")}`;
const tag = randomBytes(4).toString("hex");
const account = { id: `e2e_${tag}_acct`, username: `e2e-sess-${tag}`, typistName: `Ada-S${tag}` };
const guest = { id: `e2e_${tag}_gst`, typistName: `Guest-S${tag}` };

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/** fc_guest as src/server/auth/guest-cookie.ts signs it: `<id>.<base64url(HMAC-SHA256(id, AUTH_SECRET))>`. */
function guestCookie(id: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set for the e2e process");
  return `${id}.${createHmac("sha256", secret).update(id).digest("base64url")}`;
}

test.describe("Session viewer resolver (#787)", () => {
  // One project is enough: the header docket is checked by text, not layout.
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only");

  test.beforeAll(async () => {
    const passwordHash = await hash(PASSWORD, {
      algorithm: 2, // Argon2id
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    await withDb(async (db) => {
      await db.query(
        `INSERT INTO "User" (id, "isGuest", "typistName", username, "usernameNormalized", "passwordHash")
         VALUES ($1, false, $2, $3, $3, $4)`,
        [account.id, account.typistName, account.username, passwordHash],
      );
      await db.query(`INSERT INTO "User" (id, "isGuest", "typistName") VALUES ($1, true, $2)`, [
        guest.id,
        guest.typistName,
      ]);
    });
  });

  test.afterAll(async () => {
    await withDb((db) =>
      db.query(`DELETE FROM "User" WHERE id = ANY($1)`, [[account.id, guest.id]]),
    );
  });

  test("C4 sign-in resolves to the account over the guest; a tokenVersion bump revokes the cookie", async ({
    page,
    baseURL,
  }) => {
    const context = page.context();
    const request = context.request;
    await context.addCookies([{ name: "fc_guest", value: guestCookie(guest.id), url: baseURL! }]);

    // Guest only: the docket names the guest.
    await page.goto("/");
    const header = page.locator("header");
    await expect(header).toContainText(guest.typistName);
    await expect(header.getByText("GUEST", { exact: true })).toBeVisible();

    // Sign in with the credentials callback, csrf token included.
    const csrf = (await (await request.get("/api/auth/csrf")).json()) as { csrfToken: string };
    const signIn = await request.post("/api/auth/callback/credentials", {
      form: {
        csrfToken: csrf.csrfToken,
        username: account.username,
        password: PASSWORD,
        callbackUrl: "/",
      },
      maxRedirects: 0,
    });
    expect(signIn.status()).toBe(302);
    const session = (await context.cookies()).find((c) => c.name === SESSION_COOKIE);
    expect(session, "session cookie").toBeDefined();

    const signedIn = await request.get("/api/auth/session");
    expect(((await signedIn.json()) as { user?: { name?: string } }).user?.name).toBe(
      account.typistName,
    );

    // Session and fc_guest together: the account wins, no GUEST tag.
    await page.goto("/");
    await expect(header).toContainText(`Comrade ${account.typistName}`);
    await expect(header).not.toContainText(guest.typistName);
    await expect(header.getByText("GUEST", { exact: true })).toHaveCount(0);

    // Revoke: bump tokenVersion directly in the DB.
    await withDb((db) =>
      db.query(`UPDATE "User" SET "tokenVersion" = "tokenVersion" + 1 WHERE id = $1`, [account.id]),
    );

    // The same cookie, sent explicitly, yields {} and is expired rather than refreshed.
    const revoked = await request.get("/api/auth/session", {
      headers: { cookie: `${SESSION_COOKIE}=${session!.value}` },
    });
    expect(revoked.status()).toBe(200);
    expect(await revoked.json()).toEqual({});
    const expiry = revoked
      .headersArray()
      .filter(
        (h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith(`${SESSION_COOKIE}=`),
      );
    expect(expiry.map((h) => h.value)).toEqual([expect.stringMatching(/Max-Age=0/)]);

    // The page with the same (stale) session cookie back next to fc_guest: the guest path again.
    await context.addCookies([{ name: SESSION_COOKIE, value: session!.value, url: baseURL! }]);
    expect((await context.cookies()).some((c) => c.name === SESSION_COOKIE)).toBe(true);
    await page.goto("/");
    await expect(header).toContainText(guest.typistName);
    await expect(header.getByText("GUEST", { exact: true })).toBeVisible();
    await expect(header).not.toContainText(account.typistName);
  });
});
