import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { apexRedirect, requestHost } from "@/lib/canonical-host";
import { servesVisitorHome, VISITOR_HOME } from "@/lib/visitor-home";

/** Auth.js's session cookie names (http, https) and the first chunk of a split cookie. */
const SESSION_COOKIES = [
  "authjs.session-token",
  "authjs.session-token.0",
  "__Secure-authjs.session-token",
  "__Secure-authjs.session-token.0",
];

/** The guest identity cookie (ADR 0009, `GUEST_COOKIE` in src/server/auth/guest-cookie.ts). */
const GUEST_COOKIE = "fc_guest";

/** The paths behind a session or a guest cookie (the optimistic redirect below). */
const GUARDED = /^\/(settings|profile|locker)(\/|$)/;

/**
 * Redirects, plus the visitor rewrite below (Next 16 proxy). First the bare domain (#951): a request whose host is the canonical
 * host (`NEXT_PUBLIC_APP_URL`) minus its `www.` gets a 308 to the same path and query on the canonical
 * origin (the race server's CORS origin and the OAuth callbacks are www only). Then the optimistic
 * redirects (ADR 0009): a request for `/settings`, `/profile` or `/locker`
 * without a session cookie goes to `/sign-in?callbackUrl=<path>`; all three also let a guest through (#66:
 * a guest keeps settings too; #932: a guest has a Personnel file; #943: and a locker). Nothing is decoded or trusted here: a present cookie
 * lets the request through, and the page and its actions still authorize (`requireViewer`, `getViewer`).
 * One rewrite, not a redirect (#999, ADR 0026): a GET of `/` with neither cookie is served the landing-only
 * route module (`VISITOR_HOME`), so a first-time visitor never downloads the Home menu's client code; the
 * URL stays `/`. It routes by cookie presence only and decides nothing about identity.
 */
export function proxy(request: NextRequest) {
  const host = requestHost(request.headers.get("x-forwarded-host"), request.headers.get("host"));
  const canonical = apexRedirect(
    host,
    env.NEXT_PUBLIC_APP_URL,
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  if (canonical) return NextResponse.redirect(canonical, 308);
  const identified =
    SESSION_COOKIES.some((name) => request.cookies.has(name)) || request.cookies.has(GUEST_COOKIE);
  if (servesVisitorHome(request.method, request.nextUrl.pathname, identified)) {
    const url = request.nextUrl.clone();
    url.pathname = VISITOR_HOME;
    return NextResponse.rewrite(url);
  }
  if (!GUARDED.test(request.nextUrl.pathname)) return NextResponse.next();
  if (identified) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = new URLSearchParams({ callbackUrl: request.nextUrl.pathname }).toString();
  return NextResponse.redirect(url);
}

/**
 * Every route but the static files and the server-to-server routes (`/api/internal/*` is the race
 * server's, `/api/health` the deploy check's: both reach the app by its own URL, never the bare domain).
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|api/internal|api/health|favicon.ico).*)"],
};
