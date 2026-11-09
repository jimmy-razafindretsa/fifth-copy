import type { RoomCode } from "@fifth-copy/protocol";

export type CreateLobbyResult =
  | { ok: true; code: RoomCode }
  | { ok: false; error: "race-server-unavailable" | "invalid-settings" };

export type JoinByCodeResult =
  | { ok: true; code: RoomCode }
  | { ok: false; error: "invalid-format" | "not-found" | "closed" | "rate-limited" };

export type RaceTokenResult =
  | { ok: true; token: string; url: string }
  | { ok: false; error: "not-found" | "closed" | "rate-limited" };

/** setLobbyType's answer (#114): the host's lobby is now `type`, or why not. */
export type SetLobbyTypeResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "not-found" | "not-host" | "closed" | "rate-limited" };

/** A public room a visitor can join right now (#806): counts only, never names or user ids. */
export type OpenLobby = { code: string; typists: number; bots: number; seats: number };

/** listOpenLobbies' answer (#806); the landing's open-rooms docket renders it (#807). */
export type ListOpenLobbiesResult =
  { ok: true; lobbies: OpenLobby[] } | { ok: false; error: "race-server-unavailable" };
