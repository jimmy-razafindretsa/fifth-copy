// Stats feature (ADR 0008, #931): the Personnel file read path over stored race results. Reads
// `RaceResult` through `@/features/results`' COUNTED_RACE, never raw keystrokes. Server-only exports
// (getProfile): never import this index from a client component; client code imports types only.
export { getProfile } from "./queries/get-profile";
export {
  emptyProfile,
  LANGUAGES,
  SERIES_LIMIT,
  type Language,
  type LanguageStats,
  type Profile,
  type ProfileActivity,
  type ProfileProgress,
  type SeriesPoint,
} from "./view/profile";
export { PROFILE_FIXTURE_NOW, type ProfileFixture, profileFixtures } from "./view/profile-fixtures";
