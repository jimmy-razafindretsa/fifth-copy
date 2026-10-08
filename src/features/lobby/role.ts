import type { RaceRole } from "@fifth-copy/protocol";

// The viewer's role in a lobby, computed in one place (ADR 0001, 0009). A spectator request wins
// over host and player: the host's projector tab is read-only too (#187).
export type LobbyRole = RaceRole;

export function roleFor(
  lobby: { hostUserId: string },
  viewerId: string,
  { spectator = false }: { spectator?: boolean } = {},
): LobbyRole {
  if (spectator) return "spectator";
  return lobby.hostUserId === viewerId ? "host" : "player";
}
