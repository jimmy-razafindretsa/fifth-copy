import { type NextRequest, NextResponse } from "next/server";

/** Auth.js's session cookie names (http, https) and the first chunk of a split cookie. */
const SESSION_COOKIES = [
  "authjs.session-token",
  "authjs.session-token.0",
  "__Secure-authjs.session-token",
  "__Secure-authjs.session-token.0",
];

/** The guest identity cookie (ADR 0009, `GUEST_COOKIE` in src/server/auth/guest-cookie.ts). */
const GUEST_COOKIE = "fc_guest";

/**
 * Optimistic redirects only (ADR 0009, Next 16 proxy): a request for `/settings`, `/profile` or `/locker`
 * without a session cookie goes to `/sign-in?callbackUrl=<path>`; all three also let a guest through (#66:
 * a guest keeps settings too; #932: a guest has a Personnel file; #943: and a locker). Nothing is decoded or trusted here: a present cookie
 * lets the request through, and the page and its actions still authorize (`requireViewer`, `getViewer`).
 */
export function proxy(request: NextRequest) {
  if (SESSION_COOKIES.some((name) => request.cookies.has(name))) return NextResponse.next();
  if (request.cookies.has(GUEST_COOKIE)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = new URLSearchParams({ callbackUrl: request.nextUrl.pathname }).toString();
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/settings/:path*", "/profile/:path*", "/locker/:path*"] };
