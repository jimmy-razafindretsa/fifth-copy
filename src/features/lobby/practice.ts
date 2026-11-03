import type { RaceSettings } from "@fifth-copy/protocol";

/** The bots a practice race seats when the caller names none (#367): two, a clerk and an officer. */
export const DEFAULT_PRACTICE_BOTS: RaceSettings["bots"] = [
  { level: "clerk" },
  { level: "officer" },
];
