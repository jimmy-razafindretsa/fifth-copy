// The viewer's role in a lobby, computed in one place (extension point: `spectator`).
export type LobbyRole = "host" | "player";

export function roleFor(lobby: { hostUserId: string }, viewerId: string): LobbyRole {
  return lobby.hostUserId === viewerId ? "host" : "player";
}
