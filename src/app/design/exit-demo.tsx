"use client";

import { AsleepAtDesk, type ExitLabels, ReassignedNotice } from "@/features/race";

const noop = () => {};

/** The specimen's stats and waiting room (#777): fixture numbers, the demo room's route. */
const STATS = { wpm: 42, accuracy: 93, leaveHref: "/lobby/DEMO" } as const;

/**
 * A still specimen of one exit docket (#777, #233, bible 7.4 "Exit dockets"): KEEP WATCHING does nothing,
 * so the docket stays put; the link goes to the demo room's waiting room.
 */
export function ExitSpecimen({
  kind,
  labels,
}: {
  kind: "abandoned" | "asleep";
  labels: ExitLabels;
}) {
  const Docket = kind === "abandoned" ? ReassignedNotice : AsleepAtDesk;
  return <Docket {...STATS} onKeepWatching={noop} labels={labels} />;
}
