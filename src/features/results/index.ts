// Results feature (ADR 0008): owns the durable race rows of prisma/schema/race.prisma
// (Race, RaceResult, RaceKeystrokes). Server-only exports: never import this index from a client
// component.
export { startRace } from "./actions/start-race";
export type { StartRaceResult } from "./actions/start-race";
