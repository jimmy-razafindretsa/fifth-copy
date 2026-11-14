// Stats feature (ADR 0008, #931): the Personnel file read path over stored race results. Reads
// `RaceResult` through `@/features/results`' COUNTED_RACE, never raw keystrokes. Server-only exports
// (getProfile): never import this index from a client component; client code imports types only.
export { getProfile } from "./queries/get-profile";
export {
  EMPTY_SERVICE,
  emptyProfile,
  LANGUAGES,
  SERIES_LIMIT,
  type Language,
  type LanguageStats,
  type Profile,
  type ProfileActivity,
  type ProfileProgress,
  type ProfileService,
  type SeriesPoint,
} from "./view/profile";
export { PROFILE_FIXTURE_NOW, type ProfileFixture, profileFixtures } from "./view/profile-fixtures";
// The Personnel file screen (#932): the route and `/design#profile` compose it.
export {
  ProfileScreen,
  profileLabels,
  type ProfileLabels,
  type ProfileLinks,
  type ProfileScreenProps,
} from "./components/profile-screen";
// The Home menu (#943, #945): today's mission and the stars, and the rank scale of the player docket.
export { getMissions } from "./queries/get-missions";
export {
  MISSION_TEMPLATES,
  missionFor,
  type MissionId,
  type MissionProgress,
  type Missions,
} from "./view/missions";
export { rankFor, rankIndex, type RankStep } from "./view/rank";
