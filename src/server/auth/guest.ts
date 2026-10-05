import { GUEST_COOKIE, verifyGuestCookie } from "./guest-cookie";
import type { ViewerResolver } from "./types";

// The subset of Next's cookie store the guest identity uses.
export type GuestCookieJar = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: object): unknown;
  delete(name: string): unknown;
};

export type GuestRow = {
  id: string;
  typistName: string;
  isGuest: boolean;
  avatarStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
};

type GuestResolverDeps = {
  getCookieJar: () => Promise<GuestCookieJar>;
  findGuestById: (id: string) => Promise<GuestRow | null>;
  secret: string;
};

// Resolves the fc_guest cookie to a guest Viewer (ADR 0009). Read-only: never
// creates a row (guests are created only by ensureGuest on a write).
export function createGuestResolver(deps: GuestResolverDeps): ViewerResolver {
  return async () => {
    const jar = await deps.getCookieJar();
    const value = jar.get(GUEST_COOKIE)?.value;
    if (value === undefined) return null;
    const id = verifyGuestCookie(value, deps.secret);
    const row = id === null ? null : await deps.findGuestById(id);
    if (!row?.isGuest) {
      clear(jar);
      return null;
    }
    return {
      id: row.id,
      name: row.typistName,
      isGuest: true,
      hasAvatar: row.avatarStatus === "APPROVED",
    };
  };
}

// Best-effort: Next only allows .delete in a Server Function or Route Handler
// and throws during Server Component render. ensureGuest overwrites it anyway.
function clear(jar: GuestCookieJar) {
  try {
    jar.delete(GUEST_COOKIE);
  } catch {
    // read-only request: the cookie stays until the next write replaces it
  }
}
