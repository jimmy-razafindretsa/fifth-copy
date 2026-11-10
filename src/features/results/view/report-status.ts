/** `RaceResult.status` (prisma/schema/race.prisma), as stored. */
export const REPORT_STATUSES = [
  "FINISHED",
  "TIMED_OUT",
  "REASSIGNED",
  "ASLEEP",
  "LINE_CUT",
  "EXPIRED",
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
