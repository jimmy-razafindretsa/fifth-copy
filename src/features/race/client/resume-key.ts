import { resumeKeySchema } from "@fifth-copy/protocol";

/**
 * The desk's resume key between pages (#561 C11, ARCHITECTURE 7.4): the race server issues it in
 * `welcome.resumeKey`; a handshake carrying it gets the user's line-cut desk back during a race. It
 * lives in this tab's `sessionStorage` only (never a cookie, the URL or a query, ADR 0009), one entry
 * per lobby. Every call survives a missing or throwing storage (server render, blocked site data, a
 * full quota) and reads `null` then: without a key the page simply joins without resuming.
 */
export const RESUME_KEY_PREFIX = "fifth-copy:resume:";

type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function session(): KeyStorage | null {
  try {
    return window.sessionStorage ?? null;
  } catch {
    // no window (server render), or the getter throws (blocked site data)
    return null;
  }
}

const isResumeKey = (value: unknown): value is string => resumeKeySchema.safeParse(value).success;

export function storeResumeKey(lobbyId: string, key: string): void {
  if (!isResumeKey(key)) return;
  try {
    session()?.setItem(RESUME_KEY_PREFIX + lobbyId, key);
  } catch {
    // quota or private mode: the next page joins without resuming
  }
}

/**
 * The stored key, or `null` (none, storage unavailable, or a value that is not a resume key: sent in
 * the handshake it would fail the auth parse and refuse the socket as `bad-token`).
 */
export function readResumeKey(lobbyId: string): string | null {
  try {
    const value = session()?.getItem(RESUME_KEY_PREFIX + lobbyId) ?? null;
    return isResumeKey(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearResumeKey(lobbyId: string): void {
  try {
    session()?.removeItem(RESUME_KEY_PREFIX + lobbyId);
  } catch {
    // nothing to clear
  }
}
