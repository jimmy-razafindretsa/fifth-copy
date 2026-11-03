import type { Viewer, ViewerResolver } from "./types";

/** The part of the Auth.js session the resolver trusts: `session.user` as the session callback builds it. */
export type SessionClaims = { user?: { id?: unknown; name?: unknown; tokenVersion?: unknown } };

/** The account row the resolver reads by the session's `sub`. */
export type AccountRow = {
  typistName: string;
  isGuest: boolean;
  tokenVersion: number;
  avatarStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
};

export type FindAccountById = (id: string) => Promise<AccountRow | null>;

type SessionResolverDeps = {
  /** The decoded session, or null when the request carries none (no DB read then). */
  getSession: () => Promise<SessionClaims | null>;
  findAccountById: FindAccountById;
};

/**
 * Maps a decoded session to the account viewer (ADR 0009): one row read by id, and a viewer only when the
 * row exists, is not a guest and its `tokenVersion` equals the token's. Bumping `User.tokenVersion` (sign
 * out everywhere, password change) revokes every older JWT. Read-only: never writes a row or a cookie.
 */
export async function accountViewer(
  claims: SessionClaims | null,
  findAccountById: FindAccountById,
): Promise<Viewer | null> {
  const id = claims?.user?.id;
  const tokenVersion = claims?.user?.tokenVersion;
  if (typeof id !== "string" || id === "" || !Number.isInteger(tokenVersion)) return null;
  const row = await findAccountById(id);
  if (!row || row.isGuest || row.tokenVersion !== tokenVersion) return null;
  return { id, name: row.typistName, isGuest: false, hasAvatar: row.avatarStatus === "APPROVED" };
}

export function createSessionResolver(deps: SessionResolverDeps): ViewerResolver {
  return async () => accountViewer(await deps.getSession(), deps.findAccountById);
}
