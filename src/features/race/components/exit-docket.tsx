import { Button, Stamp } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ExitDocketKind, ExitLabels } from "../view/hud-labels";
import docket from "./hud-docket.module.css";
import styles from "./exit-docket.module.css";

/** One row of partial stats: `WPM | 42`. */
export type ExitRow = { id: string; label: string; value: string };

export type ExitDocketProps = {
  kind: ExitDocketKind;
  /** Your partial stats, in order; empty = no rows. */
  rows: readonly ExitRow[];
  /** KEEP WATCHING: the caller closes the docket (the HUD stays live without input). */
  onKeepWatching: () => void;
  /** The waiting room's route (`/lobby/[code]`). */
  leaveHref: string;
  /** The link's copy: `BACK TO THE WAITING ROOM →` or `LEAVE →`. */
  leaveLabel: string;
  labels: ExitLabels;
};

/**
 * An exit docket (#233, design bible 7.3, 7.4, 7.1, 14.3 extension): one HUD docket at the top of the
 * middle column, named by its stamp. The ink `Stamp` (neutral paperwork) at `md` at its seeded angle,
 * slamming in (simply there under reduced motion), then your partial stats as 7.4 rows, then the 7.1
 * secondary button `KEEP WATCHING` and the ink link back to the waiting room. A docket in the flow, not
 * a modal: no focus move, no trap. Presentational: the numbers are the caller's (ADR 0007).
 */
export function ExitDocket({
  kind,
  rows,
  onKeepWatching,
  leaveHref,
  leaveLabel,
  labels,
}: ExitDocketProps) {
  const title = labels.stamp[kind];
  return (
    <section aria-label={title} data-exit={kind} className={cn(docket.docket, styles.view)}>
      <div className={styles.stamp}>
        <Stamp size="md" tone="ink" rotation="auto" seed={`exit-${kind}`} lines={[title]} />
      </div>
      {rows.length > 0 ? (
        <dl className={styles.rows}>
          {rows.map((r) => (
            <div key={r.id} data-row={r.id} className={docket.row}>
              <dt className={docket.label}>{r.label}</dt>
              <dd className={docket.value}>{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className={styles.actions}>
        <Button variant="secondary" className="min-h-11" onClick={onKeepWatching}>
          {labels.keepWatching}
        </Button>
        <a href={leaveHref} className={cn(docket.ink, styles.leave)}>
          {leaveLabel}
        </a>
      </div>
    </section>
  );
}
