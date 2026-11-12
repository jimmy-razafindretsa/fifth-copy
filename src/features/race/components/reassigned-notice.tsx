import { fill } from "@/i18n/format";
import type { ExitLabels } from "../view/hud-labels";
import { ExitDocket } from "./exit-docket";

export type ExitStatsProps = {
  /** Your clean WPM, frozen at your last key (ADR 0016, the nixie's figure). */
  wpm: number;
  /** Your accuracy in whole percent (the engine's `accuracy`). */
  accuracy: number;
  /** The waiting room's route (`/lobby/[code]`). */
  leaveHref: string;
  onKeepWatching: () => void;
  labels: ExitLabels;
};

/**
 * The Reassigned notice (#233 C3, spec 4.4): after ABANDON, the `REASSIGNED` docket with your partial
 * stats `WPM | 42`, `ACCURACY | 93 %` and `PLACE | LAST` (Reassigned ranks last, ADR 0007), KEEP WATCHING
 * and `BACK TO THE WAITING ROOM →`.
 */
export function ReassignedNotice({
  wpm,
  accuracy,
  leaveHref,
  onKeepWatching,
  labels,
}: ExitStatsProps) {
  return (
    <ExitDocket
      kind="abandoned"
      rows={[
        { id: "wpm", label: labels.wpm, value: String(wpm) },
        { id: "accuracy", label: labels.accuracy, value: fill(labels.percent, { n: accuracy }) },
        { id: "place", label: labels.place, value: labels.last },
      ]}
      onKeepWatching={onKeepWatching}
      leaveHref={leaveHref}
      leaveLabel={labels.back}
      labels={labels}
    />
  );
}
