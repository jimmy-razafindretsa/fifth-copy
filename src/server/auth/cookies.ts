// Cookie policy of the web app (#87 C1, ADR 0009). Pure: no IO, the environment is passed in.
// Every cookie the app sets (the Auth.js session, `fc_guest`, `locale`, `theme`) carries these flags:
// HttpOnly (no script reads it), SameSite=Lax (no cross-site POST carries it), Path=/, and Secure in
// production. The session cookie also takes the `__Secure-` prefix there (`useSecureCookies`).

export type NodeEnv = "development" | "test" | "production";

/** Auth.js's session cookie name, without and with the `__Secure-` prefix. */
export const SESSION_COOKIE_NAME = "authjs.session-token";
export const SECURE_SESSION_COOKIE_NAME = `__Secure-${SESSION_COOKIE_NAME}`;

/** The flags shared by every cookie the app sets. */
export function cookieFlags(nodeEnv: NodeEnv) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: nodeEnv === "production",
  };
}

/**
 * Auth.js `useSecureCookies`: on in production whatever the request scheme says, so a proxy that
 * forwards plain http never downgrades the session cookie (Secure flag and `__Secure-` name).
 */
export function useSecureCookies(nodeEnv: NodeEnv): boolean {
  return nodeEnv === "production";
}

/** The session cookie's name in `nodeEnv`. */
export function sessionCookieName(nodeEnv: NodeEnv): string {
  return useSecureCookies(nodeEnv) ? SECURE_SESSION_COOKIE_NAME : SESSION_COOKIE_NAME;
}
