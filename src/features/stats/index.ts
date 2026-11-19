// Stats feature (ADR 0008, #931): the Personnel file read path over stored race results. Reads
// `RaceResult` through `@/features/results`' COUNTED_RACE, never raw keystrokes. Server-only exports
// (getProfile): never import this index from a client component; client code imports types only.
// Guest merge steps (ADR 0009, #999): achievements and personal bests; listed in package.json sideEffects.
import "./merge-steps";
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
// The attendance register (#330): the daily goal the goal setting (#968) replaces with the viewer's own.
export {
  ATTENDANCE_MONTHS,
  DEFAULT_DAILY_GOAL_MIN,
  type AttendanceDay,
  type AttendanceLevel,
  type AttendanceMonth,
  type ProfileAttendance,
} from "./view/attendance";
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
// The typist census (#966, ADR 0023): population shapes as aggregates only. getCensus is server-only.
export { getCensus } from "./queries/get-census";
export {
  CENSUS_MIN_POPULATION,
  CENSUS_MIN_RACES,
  type Census,
  type CensusDistribution,
} from "./view/census";
export { type CensusFixture, censusFixtures } from "./view/census-fixtures";
// The per-key sections of the Personnel file (#961, ADR 0008, 0024): the key file over the daily
// aggregates. getKeyFile is server-only; the rest is pure and client-safe.
export { getKeyFile } from "./queries/get-key-file";
export {
  emptyKeyFile,
  KEY_FILE_DAYS,
  KEY_GOAL_WPM,
  keyFileOf,
  REFERENCE_KEYS,
  type CharCount,
  type CharStatRow,
  type KeyFile,
  type KeyFileEntry,
  type KeyFilePair,
  type KeyState,
  type PairStatRow,
} from "./view/key-file";
export { type KeyFileFixture, keyFileFixtures } from "./view/key-file-fixtures";
// Personal bests (#999 C41, ADR 0016): the one pure rule and the viewer's query (server-only).
export {
  bestKeyOf,
  type BestKey,
  type BestLanguage,
  type BestLength,
  type BestTextType,
  isPersonalBest,
  LENGTH_BUCKETS,
  lengthOf,
} from "./personal-bests/rule";
export { getPersonalBests, type PersonalBestRow } from "./personal-bests/query";
// Achievements (#999 C34, C35): the stable ids and the pure award rules.
export { ACHIEVEMENT_IDS, type AchievementId, isAchievementId } from "./achievements/ids";
export { earnedBy, type AwardFacts } from "./achievements/rules";
// The enamel pins of the Personnel file (#999 C36): the pure shelf and the viewer's read (server-only).
export {
  emptyShelf,
  MEDAL_NEW_DAYS,
  type Medal,
  type MedalShelf,
  type MedalState,
  medalShelf,
} from "./view/medals";
export { getMedals } from "./queries/get-medals";
