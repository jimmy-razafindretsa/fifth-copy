import type { OpenLobby } from "./types";

/**
 * Which open public room QUICK RACE seats a visitor in (#128): the first of `listOpenLobbies()`'s
 * answer (most typists, then newest), or null when none is open. Pure, so a later rule (language
 * match, friends) replaces this one function. Only a room the query returned is ever picked.
 */
export function pickRoom(lobbies: readonly OpenLobby[]): OpenLobby | null {
  return lobbies[0] ?? null;
}
