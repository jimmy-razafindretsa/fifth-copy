// Server-only lobby API (ADR 0021): what routes and server code may import beside `index.ts`.
import "server-only";

// The public rooms a visitor can join right now (#806): the landing's open-rooms docket and Quick race.
export { listOpenLobbies } from "./queries/list-open-lobbies";
export type { ListOpenLobbiesResult, OpenLobby } from "./queries/list-open-lobbies";

// The race server's close call (#734): the one route that writes a lobby CLOSED.
export { closeLobby } from "./queries/close-lobby";
export type { CloseLobbyResult } from "./queries/close-lobby";
