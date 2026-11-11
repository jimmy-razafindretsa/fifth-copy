import type { RoomCode } from "@fifth-copy/protocol";

export type CreateLobbyResult =
  | { ok: true; code: RoomCode }
  | { ok: false; error: "race-server-unavailable" | "invalid-settings" };

/**
 * quickRace's answer (#128): the room to go to, `joined` when it is an open room the query returned,
 * else a new public room the caller hosts; or why not.
 */
export type QuickRaceResult =
  | { ok: true; code: RoomCode; joined: boolean }
  | { ok: false; error: "race-server-unavailable" | "invalid-settings" | "rate-limited" };

export type JoinByCodeResult =
  | { ok: true; code: RoomCode }
  | { ok: false; error: "invalid-format" | "not-found" | "closed" | "rate-limited" };

export type RaceTokenResult =
  | { ok: true; token: string; url: string }
  | { ok: false; error: "not-found" | "closed" | "rate-limited" };

/** setLobbyType's answer (#114): the host's lobby is now `type`, or why not. */
/** `unavailable`: the race server did not answer (#815); nothing was written, the host retries. */
export type SetLobbyTypeResult =
  | { ok: true }
  | {
      ok: false;
      error: "invalid" | "not-host" | "closed" | "rate-limited" | "unavailable";
    };

/** A public room a visitor can join right now (#806): counts only, never names or user ids. */
export type OpenLobby = { code: string; typists: number; bots: number; seats: number };

/** listOpenLobbies' answer (#806); the landing's open-rooms docket renders it (#807). */
export type ListOpenLobbiesResult =
  { ok: true; lobbies: OpenLobby[] } | { ok: false; error: "race-server-unavailable" };

/** createInvite's answer (#808): the single-use link `${NEXT_PUBLIC_APP_URL}/invite/<token>`, or why not. */
export type CreateInviteResult =
  | { ok: true; url: string }
  | {
      ok: false;
      error: "invalid" | "not-found" | "not-host" | "closed" | "rate-limited" | "unavailable";
    };

/** redeemInvite's answer (#808): the lobby's code, once per token. `not-found`: never issued, used or expired. */
export type RedeemInviteResult =
  | { ok: true; code: RoomCode }
  | { ok: false; error: "invalid" | "not-found" | "closed" | "rate-limited" | "unavailable" };

/** peekInvite's answer (#808): the token is on file, or why not. */
export type PeekInviteResult =
  { ok: true } | { ok: false; error: "invalid" | "not-found" | "rate-limited" | "unavailable" };

/**
 * What `/invite/[token]` shows (#809): the invitation (`invite`), the stamped refusal (`refused`: used,
 * expired, never issued, or lost to another press), or the refusal screen with an inline error line
 * in place of the stamp (`closed`, `rate-limited`, `unavailable`).
 */
export type InviteOutcome = "invite" | "refused" | "closed" | "rate-limited" | "unavailable";
