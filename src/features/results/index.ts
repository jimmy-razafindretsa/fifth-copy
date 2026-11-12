// Results feature (ADR 0008): owns the durable race rows of prisma/schema/race.prisma
// (Race, RaceResult, RaceKeystrokes). Server-only exports: never import this index from a client
// component.
// Registers the RaceResult and RaceKeystrokes steps of the guest merge (#56).
import "./merge-steps";
export { startRace } from "./actions/start-race";
export type { StartRaceResult } from "./actions/start-race";
export { MAX_RESULTS_BODY_BYTES, persistRaceResults } from "./actions/persist-results";
export type { PersistResultsResult } from "./actions/persist-results";
// The text a stored result's trace replays on: base + the desk's stored overlay (#623).
export { storedEffectiveText, type StoredReplayText } from "./replay-text";
// The Dawn report (#300): read model, route screen, podium and the /design specimens.
export { getDawnReport } from "./queries/get-dawn-report";
// The races stats and results count (#613): never a voided or open one.
export { COUNTED_RACE } from "./queries/counted-races";
// Lobby mates of the last 24 h (#880, ADR 0022): path (b) of `shareLobby` in features/lobby.
export { racedTogether, RACED_TOGETHER_WINDOW_MS } from "./queries/raced-together";
export { DawnReportLayout, DawnReportScreen } from "./components/dawn-report-screen";
export {
  filingLabels,
  type PersonalLabels,
  personalLabels,
  podiumLabels,
  rankingLabels,
  type ReportAction,
  reportActions,
} from "./view/report-labels";
// The action row (#143, #863): RACE AGAIN, the way home, a guest member's prompt to open a file.
export { ReportActions } from "./components/report-actions";
// The personal stats card (#864, #302): the viewer's own figures and bonuses, beside the ranking.
export { PersonalCard, type PersonalCardProps } from "./components/personal-card";
export type { BonusTally, PersonalStats } from "./view/personal";
// The WPM graph (#865): the viewer's own series and received-bonus marks, and its card section.
export { getPersonalReplay, getRaceSeries, type PersonalReplay } from "./queries/get-race-series";
export { RaceGraph, type RaceGraphProps } from "./components/race-graph";
export type { BonusMark, RaceSeries } from "./view/series";
// Errors by key and the one tip (#867): the viewer's missed keys and the pure tip choice.
export { coachingFrom, type Coaching, pickTip, type Tip, TIP_IDS } from "./view/tip";
export type { MissedKey } from "./view/keys";
export { FilingNoticeView } from "./components/filing-notice-view";
// Every internal link the report offers, from the guarded link tables (#899).
export { REPORT_LINKS } from "./view/links";
export { Podium, type PodiumProps } from "./components/podium";
// The ranking docket (#301): every desk in place order, under the podium.
export { RankingTable, type RankingTableProps } from "./components/ranking-table";
export { initialsOf, type RankingLabels, type RankingRow, rankingRowsFrom } from "./view/ranking";
export {
  coachingFixtures,
  type CoachingFixture,
  dawnReportFixtures,
  type DawnReportFixture,
  personalFixtures,
  type PersonalFixture,
  raceSeriesFixtures,
  type RaceSeriesFixture,
} from "./view/dawn-report-fixtures";
export {
  type DawnReport,
  MEDAL_VARIANTS,
  type MedalVariant,
  type PodiumLabels,
  type ReportEntry,
  type ReportRace,
  type ReportStatus,
} from "./view/dawn-report";
