import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

// #932 C2 (and #66): optimistic redirects only. A session or a guest cookie passes on /settings and
// /profile; a visitor with neither goes to /sign-in with the path as callbackUrl.
const request = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: cookie ? { cookie } : undefined,
  });
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy", () => {
  it("matches only /settings, /profile and /locker (#943)", () => {
    expect(config.matcher).toEqual(["/settings/:path*", "/profile/:path*", "/locker/:path*"]);
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
});
