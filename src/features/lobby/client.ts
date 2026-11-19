/**
 * The lobby's light client door (#999 C57, ADR 0026): the entry controls a landing renders. Everything
 * reachable from here stays out of the lobby store, the race socket client, zod and the server entry
 * (dependency-cruiser `feature-client-entry-light`), so a route that imports only this door ships none
 * of them. No side-effect import here: the guest-merge registration stays in index.ts.
 */
export { LobbyEntries } from "./components/lobby-entries";
export { QuickRaceButton } from "./components/quick-race-button";
