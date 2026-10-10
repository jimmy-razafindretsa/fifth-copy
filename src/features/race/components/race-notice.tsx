import { cn } from "@/lib/cn";
import type { RaceNoticeKind, RaceNoticeLabels } from "../view/hud-labels";
import docket from "./hud-docket.module.css";
import styles from "./race-notice.module.css";

export type RaceNoticeProps = {
  kind: RaceNoticeKind;
  labels: RaceNoticeLabels;
};

/**
 * A race notice (#560, design bible 7.4 notice row, 8): the live-state label row for waiting for the
 * host, a cut line, the idle warning (the urgent tone, bible 0: red marks urgency) and a room without
 * its 3D picture, as a one-row docket. A polite `status` region; it pulses with `lkPulse` and holds still
 * under reduced motion. Which notice shows is the caller's (#561, #233, #235, #563).
 */
export function RaceNotice({ kind, labels }: RaceNoticeProps) {
  return (
    <p
      role="status"
      data-notice={kind}
      data-tone={kind === "idle-warning" ? "urgent" : undefined}
      className={cn(docket.notice, docket.pulse, styles.notice)}
    >
      {labels[kind]}
    </p>
  );
}
