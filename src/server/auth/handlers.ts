import "server-only";
import type { NextRequest } from "next/server";
import { nextAuthHandlers } from "./auth";
import { findAccountById, SESSION_COOKIES } from "./resolvers";
import { accountViewer, type SessionClaims } from "./session";

const EMPTY_SESSION = "{}";

function isSessionCookie(name: string): boolean {
  return SESSION_COOKIES.some((base) => name === base || name.startsWith(`${base}.`));
}

/** Expires every session cookie (and chunk) the request carried; other Set-Cookie headers are kept. */
function signedOut(request: NextRequest, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  for (const cookie of response.headers.getSetCookie()) {
    if (!isSessionCookie(cookie.slice(0, cookie.indexOf("="))))
      headers.append("set-cookie", cookie);
  }
  for (const { name } of request.cookies.getAll()) {
    if (!isSessionCookie(name)) continue;
    const secure = name.startsWith("__Secure-") ? "; Secure" : "";
    headers.append("set-cookie", `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
  }
  return new Response(EMPTY_SESSION, { status: response.status, headers });
}

/**
 * GET /api/auth/*. Only `/session` changes: a signed-out `null` body becomes `{}` (#786 C4), and a session
 * the resolver would reject (stale `tokenVersion`, guest or missing row: `accountViewer`) answers `{}` and
 * expires the session cookie instead of refreshing it (#787 C4), so the endpoint and getViewer() agree.
 */
async function GET(request: NextRequest): Promise<Response> {
  const response = await nextAuthHandlers.GET(request);
  if (!request.nextUrl.pathname.endsWith("/session")) return response;
  if (!response.headers.get("content-type")?.startsWith("application/json")) return response;
  const body = await response.clone().text();
  if (body === "null") {
    return new Response(EMPTY_SESSION, { status: response.status, headers: response.headers });
  }
  if (!response.ok) return response;
  const claims = JSON.parse(body) as SessionClaims;
  return (await accountViewer(claims, findAccountById)) ? response : signedOut(request, response);
}

export const handlers = { GET, POST: nextAuthHandlers.POST };
