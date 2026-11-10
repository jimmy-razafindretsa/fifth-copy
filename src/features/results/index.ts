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
export { DawnReportLayout, DawnReportScreen } from "./components/dawn-report-screen";
export {
  filingLabels,
  podiumLabels,
  rankingLabels,
  type ReportAction,
  reportActions,
} from "./view/report-labels";
// The action row (#143, #863): RACE AGAIN, the way home, a guest member's prompt to open a file.
export { ReportActions } from "./components/report-actions";
export { FilingNoticeView } from "./components/filing-notice-view";
export { Podium, type PodiumProps } from "./components/podium";
// The ranking docket (#301): every desk in place order, under the podium.
export { RankingTable, type RankingTableProps } from "./components/ranking-table";
export { initialsOf, type RankingLabels, type RankingRow, rankingRowsFrom } from "./view/ranking";
export { dawnReportFixtures, type DawnReportFixture } from "./view/dawn-report-fixtures";
export {
  type DawnReport,
  MEDAL_VARIANTS,
  type MedalVariant,
  type PodiumLabels,
  type ReportEntry,
  type ReportRace,
  type ReportStatus,
} from "./view/dawn-report";
