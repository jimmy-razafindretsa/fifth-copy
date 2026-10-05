import type { RoomCode } from "@fifth-copy/protocol";

export type CreateLobbyResult =
  { ok: true; code: RoomCode } | { ok: false; error: "race-server-unavailable" };

export type JoinByCodeResult =
  { ok: true; code: RoomCode } | { ok: false; error: "invalid-format" | "not-found" | "closed" };

export type RaceTokenResult =
  { ok: true; token: string; url: string } | { ok: false; error: "not-found" | "closed" };
