/**
 * The visitor/viewer split of `/` (#999 C56, ADR 0026). A request for `/` that carries neither a session
 * nor a guest cookie can only be a first-time visitor, so the proxy serves it the landing-only route
 * module; `/` itself keeps the viewer's Home menu (and still renders the landing for a stale cookie).
 * Cookie presence only: nothing is decoded or trusted, and the page still resolves the viewer (ADR 0009).
 */
export const VISITOR_HOME = "/welcome";

/** Whether a request is served the visitor landing module instead of `/` (reads only, never actions). */
export function servesVisitorHome(method: string, pathname: string, hasIdentityCookie: boolean) {
  return pathname === "/" && (method === "GET" || method === "HEAD") && !hasIdentityCookie;
}
