import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// the proxy reads only NEXT_PUBLIC_APP_URL; the unit step runs without the app's secrets (CI)
const app = vi.hoisted(() => ({ url: "http://localhost:3000" }));
vi.mock("@/env", () => ({
  env: {
    get NEXT_PUBLIC_APP_URL() {
      return app.url;
    },
  },
}));

import { config, proxy } from "./proxy";

// #932 C2 (and #66): optimistic redirects only. A session or a guest cookie passes on /settings and
// /profile; a visitor with neither goes to /sign-in with the path as callbackUrl.
const request = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: cookie ? { cookie } : undefined,
  });
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy", () => {
  it("runs on every route but the static files, /api/internal and /api/health (#951)", () => {
    expect(config.matcher).toEqual([
      "/((?!_next/static|_next/image|api/internal|api/health|favicon.ico).*)",
    ]);
  });

  it("any other path passes without a cookie (#951: the proxy now sees every route)", () => {
    expect(passes(proxy(request("/welcome")))).toBe(true);
    expect(passes(proxy(request("/lobby/KGB-4821")))).toBe(true);
    expect(passes(proxy(request("/profiles")))).toBe(true);
  });

  // #999 C56 (ADR 0026): a cookieless GET of `/` is served the landing-only module, the URL unchanged.
  const rewrittenTo = (res: Response) => {
    const to = res.headers.get("x-middleware-rewrite");
    return to ? new URL(to).pathname : null;
  };

  it("/ without a session or guest cookie is rewritten to the visitor landing module", () => {
    expect(rewrittenTo(proxy(request("/")))).toBe("/welcome");
    expect(rewrittenTo(proxy(request("/?ref=x", "locale=fr")))).toBe("/welcome");
  });

  it("/ with a session or a guest cookie passes to the Home menu (a stale one still gets the landing there)", () => {
    expect(passes(proxy(request("/", "authjs.session-token=x")))).toBe(true);
    expect(passes(proxy(request("/", "__Secure-authjs.session-token=x")))).toBe(true);
    expect(passes(proxy(request("/", "fc_guest=abc")))).toBe(true);
  });

  it("a server action POST to / is never rewritten", () => {
    const post = new NextRequest(new URL("/", "http://localhost:3000"), { method: "POST" });
    expect(passes(proxy(post))).toBe(true);
  });

  for (const path of ["/settings", "/profile", "/locker"]) {
    it(`${path}: a session cookie passes`, () => {
      expect(passes(proxy(request(path, "authjs.session-token=x")))).toBe(true);
      expect(passes(proxy(request(path, "__Secure-authjs.session-token.0=x")))).toBe(true);
    });

    it(`${path}: a guest cookie passes`, () => {
      expect(passes(proxy(request(path, "fc_guest=abc")))).toBe(true);
    });

    it(`${path}: neither cookie goes to /sign-in?callbackUrl=${path}`, () => {
      const res = proxy(request(path, "locale=fr"));
      expect(passes(res)).toBe(false);
      expect(res.status).toBe(307);
      const to = new URL(res.headers.get("location")!);
      expect(to.pathname).toBe("/sign-in");
      expect(to.searchParams.get("callbackUrl")).toBe(path);
    });
  }

  it("#951 the bare domain gets a 308 to the canonical www origin, path and query kept", () => {
    app.url = "https://www.fifthcopy.com";
    try {
      const apex = new NextRequest(new URL("/lobby/KGB-4821?x=1", "http://localhost:8080"), {
        headers: { "x-forwarded-host": "fifthcopy.com" },
      });
      const res = proxy(apex);
      expect(res.status).toBe(308);
      expect(res.headers.get("location")).toBe("https://www.fifthcopy.com/lobby/KGB-4821?x=1");
      const www = new NextRequest(new URL("/", "http://localhost:8080"), {
        headers: { "x-forwarded-host": "www.fifthcopy.com" },
      });
      // no redirect (a cookieless `/` is then served the visitor module, #999)
      expect(proxy(www).headers.get("location")).toBeNull();
      expect(rewrittenTo(proxy(www))).toBe("/welcome");
    } finally {
      app.url = "http://localhost:3000";
    }
  });
});
