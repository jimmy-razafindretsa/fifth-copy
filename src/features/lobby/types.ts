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
