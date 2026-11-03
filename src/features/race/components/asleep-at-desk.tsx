import { fill } from "@/i18n/format";
import { ExitDocket } from "./exit-docket";
import type { ExitStatsProps } from "./reassigned-notice";

/**
 * The Asleep at desk screen (#233 C4, spec 4.5): after the server's idle kick, the `ASLEEP AT DESK`
 * docket with your partial stats `WPM | 42` and `ACCURACY | 93 %` (no place: an asleep desk ranks by
 * its frozen progress, ADR 0007, so the race card keeps it), KEEP WATCHING and `LEAVE →`. Deadpan, never
 * a joke at the student's expense (bible 2).
 */
export function AsleepAtDesk({ wpm, accuracy, leaveHref, onKeepWatching, labels }: ExitStatsProps) {
  return (
    <ExitDocket
      kind="asleep"
      rows={[
        { id: "wpm", label: labels.wpm, value: String(wpm) },
        { id: "accuracy", label: labels.accuracy, value: fill(labels.percent, { n: accuracy }) },
      ]}
      onKeepWatching={onKeepWatching}
      leaveHref={leaveHref}
      leaveLabel={labels.leave}
      labels={labels}
    />
  );
}
