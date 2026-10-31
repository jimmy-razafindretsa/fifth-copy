// Results feature (ADR 0008): owns the durable race rows of prisma/schema/race.prisma
// (Race, RaceResult, RaceKeystrokes). Server-only exports: never import this index from a client
// component.
export { startRace } from "./actions/start-race";
export type { StartRaceResult } from "./actions/start-race";
export { MAX_RESULTS_BODY_BYTES, persistRaceResults } from "./actions/persist-results";
export type { PersistResultsResult } from "./actions/persist-results";
// The Dawn report (#300): read model, route screen, podium and the /design specimens.
export { getDawnReport } from "./queries/get-dawn-report";
export { DawnReportLayout, DawnReportScreen } from "./components/dawn-report-screen";
export { filingLabels, podiumLabels, rankingLabels } from "./view/report-labels";
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
