import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";

// #87 C5: sign-in, sign-up, avatar upload and the Auth.js credentials callback spend their budgets
// (the real LIMITS rows, counted in memory here; the Redis limiter has its own suite) before any
// lookup, and a refused call answers the one bilingual "try again later" with the delay.
const s = vi.hoisted(() => ({
  locale: "en" as "en" | "fr",
  subject: "ip:203.0.113.7",
  counted: new Map<string, number>(),
  verifies: 0,
  stores: 0,
  posts: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NODE_ENV: "test", AUTH_SECRET: "t".repeat(32) } }));
vi.mock("@/server/logger", () => ({ logger: { warn: () => undefined, info: () => undefined } }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/i18n", async () => {
  const { en } = await import("@/i18n/en");
  const { fr } = await import("@/i18n/fr");
  const { fill } = await import("@/i18n/format");
  return { fill, getT: async () => (s.locale === "fr" ? fr : en) };
});
vi.mock("@/server/limiter", async () => {
  const { LIMITS } = await import("@/server/limiter/core");
  return {
    requestSubject: async () => s.subject,
    limit: async (action: keyof typeof LIMITS, subject: string) => {
      const key = `${action}:${subject}`;
      const n = s.counted.get(key) ?? 0;
      const ok = n < LIMITS[action].max;
      if (ok) s.counted.set(key, n + 1);
      return { ok, retryAfterMs: ok ? 0 : LIMITS[action].windowMs - 1 };
    },
  };
});
vi.mock("@/server/auth", () => ({
  getViewer: async () => null,
  requireViewer: async () => ({ id: "viewer-1", isGuest: true }),
  hashPassword: async () => "hash",
  verifyCredentials: async () => {
    s.verifies++;
    return null;
  },
  signIn: async () => undefined,
}));
vi.mock("@/server/db", () => ({
  db: {
    user: {
      findFirst: async () => {
        s.verifies++;
        return { id: "taken" };
      },
    },
  },
}));
vi.mock("@/features/texts", () => ({ isClean: () => true }));
vi.mock("../avatars/store-avatar", () => ({
  MAX_AVATAR_BYTES: 5 * 1024 * 1024,
  storeAvatar: async () => {
    s.stores++;
    return { version: 1, status: "APPROVED" };
  },
}));
vi.mock("../merge/merge-on-sign-in", () => ({ mergeGuestCookieInto: vi.fn() }));
vi.mock("../preferences/cookies", () => ({ refreshPreferenceCookies: vi.fn() }));
vi.mock("../recovery/reveal", () => ({ REVEAL_PATH: "/sign-up/recovery", stashReveal: vi.fn() }));

const { signIn } = await import("./sign-in");
const { signUp } = await import("./sign-up");
const { uploadAvatar } = await import("./upload-avatar");
const { withCredentialsThrottle } = await import("../auth/throttle");

const credentials = (username: string, password = "wrong-password") => {
  const f = new FormData();
  f.set("username", username);
  f.set("password", password);
  return f;
};
const enLine = (m: number) => en.auth.reset.errors["rate-limited"].replace("{m}", String(m));
const frLine = (m: number) => fr.auth.reset.errors["rate-limited"].replace("{m}", String(m));

describe("account throttles (#87 C5)", () => {
  beforeEach(() => {
    s.locale = "en";
    s.subject = "ip:203.0.113.7";
    s.counted.clear();
    s.verifies = 0;
    s.stores = 0;
    s.posts = 0;
  });

  it("sign-in: 10 per 15 min per username, then the throttle line, without a lookup", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await signIn(credentials("Ada_1"))).formError).toBe(en.auth.errors.credentials);
    }
    expect(s.verifies).toBe(10);
    // same account, any case or client: refused before verifyCredentials
    s.subject = "ip:198.51.100.2";
    expect(await signIn(credentials("ADA_1", "the-right-one"))).toEqual({
      fieldErrors: {},
      formError: enLine(15),
    });
    s.locale = "fr";
    expect((await signIn(credentials("ada_1"))).formError).toBe(frLine(15));
    expect(s.verifies).toBe(10);
    // another account is not affected
    expect((await signIn(credentials("bob_2"))).formError).toBe(fr.auth.errors.credentials);
  });

  it("sign-in: 30 per 15 min per client across usernames", async () => {
    for (let i = 0; i < 30; i++) await signIn(credentials(`user_${i}`));
    expect((await signIn(credentials("user_new"))).formError).toBe(enLine(15));
    expect(s.verifies).toBe(30);
    // a refused client attempt never spends the account budget
    expect(s.counted.get("sign-in-account:signin:user_new")).toBeUndefined();
  });

  it("sign-up: 10 per hour per client", async () => {
    for (let i = 0; i < 10; i++) {
      const state = await signUp(credentials(`new_${i}`, "long-enough-pw"));
      expect(state.fieldErrors.username).toBe(en.auth.errors.usernameTaken);
    }
    expect(await signUp(credentials("new_x", "long-enough-pw"))).toEqual({
      fieldErrors: {},
      formError: enLine(60),
    });
    expect(s.verifies).toBe(10);
  });

  it("avatar upload: 5 per minute per viewer", async () => {
    const upload = () => {
      const f = new FormData();
      f.set("file", new Blob([new Uint8Array(10)], { type: "image/png" }));
      f.set("crop", JSON.stringify({ x: 0, y: 0, size: 1 }));
      return uploadAvatar(f);
    };
    for (let i = 0; i < 5; i++) await upload();
    const stored = s.stores;
    const refused = await upload();
    expect(refused).toEqual({
      ok: false,
      code: "RateLimited",
      retryAfterMs: 59_999,
      message: enLine(1),
    });
    expect(s.stores).toBe(stored);
  });

  it("the Auth.js credentials callback spends the same sign-in budgets", async () => {
    const post = withCredentialsThrottle(async () => {
      s.posts++;
      return new Response(null, { status: 302, headers: { Location: "/" } });
    });
    const request = (path: string, username = "Ada_1") =>
      new Request(`http://localhost${path}`, {
        method: "POST",
        body: new URLSearchParams({ username, password: "x", csrfToken: "t" }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
    for (let i = 0; i < 10; i++) {
      expect((await post(request("/api/auth/callback/credentials"))).status).toBe(302);
    }
    expect(s.posts).toBe(10);
    // the action and the callback share the account budget
    expect((await signIn(credentials("ada_1"))).formError).toBe(enLine(15));
    const refused = await post(request("/api/auth/callback/credentials"));
    expect(refused.status).toBe(302);
    expect(refused.headers.get("location")).toBe("/sign-in?error=RateLimited");
    expect(Number(refused.headers.get("retry-after"))).toBe(900);
    expect(s.posts).toBe(10);
    // other Auth.js POSTs are not counted
    await post(request("/api/auth/signout"));
    expect(s.posts).toBe(11);
  });
});
