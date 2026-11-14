// Server-only lobby API (ADR 0021): what routes and server code may import beside `index.ts`.
import "server-only";

// The public rooms a visitor can join right now (#806): the landing's open-rooms docket and Quick race.
export { listOpenLobbies } from "./queries/list-open-lobbies";
export type { ListOpenLobbiesResult, OpenLobby } from "./queries/list-open-lobbies";

// The race server's close call (#734): the one route that writes a lobby CLOSED.
export { closeLobby } from "./queries/close-lobby";
export type { CloseLobbyResult } from "./queries/close-lobby";
// The race server's host transfer (#137): the durable copy of the promoted host.
export { setLobbyHost } from "./queries/set-lobby-host";
export type { SetLobbyHostResult } from "./queries/set-lobby-host";
// The lobby-scoped access rule (#880, ADR 0022): live room mates (asked of the race server) or race
// mates of the last 24 h. The avatar route passes it to `readAvatarFile`.
export { shareLobby } from "./queries/share-lobby";
// Players online on the Home menu (#943): human typists seated in live rooms, counts only.
export { countTypistsOnline } from "./queries/count-typists-online";
export type { CountTypistsOnlineResult } from "./queries/count-typists-online";
