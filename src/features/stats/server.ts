// Server-only stats API (ADR 0021): what routes and server code may import beside `index.ts`.
import "server-only";

// The site header's grade tag (#969): the viewer's `RankStep` from one aggregate of their counted results.
export { getRank } from "./queries/get-rank";
// The after-save steps of the results filing transaction (#999 C35, C41): the filing route composes them.
export { awardAchievements } from "./achievements/award";
export { recordPersonalBests } from "./personal-bests/record";
