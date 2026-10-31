import { fill } from "@/i18n/format";
import { cn } from "@/lib/cn";
import type { FinishLabels, StandingRow } from "../view/standings";
import docket from "./hud-docket.module.css";
import styles from "./finished-view.module.css";

export type FinishedViewProps = {
  /** `finished`: you finished, the race runs (live standings); `ended`: the server ended it. */
  mode: "finished" | "ended";
  /** The header's mono value: your provisional place `01 / 02`, or the end's reason; `null` = none. */
  value: string | null;
  /** In place order: the live standings, or the server's final ranking as sent. */
  rows: readonly StandingRow[];
  /** The Dawn report's route (`/results/<raceId>`); `null` = no link. */
  report: string | null;
  labels: FinishLabels;
};

const paperwork = (n: number) => String(n).padStart(2, "0");

/**
 * The finished view (#240, design bible 7.4, 7.4a, 7.1, 14.3 extension): one HUD docket at the top of
 * the middle column. After your finish, while the race runs: the tag `FILED`, your provisional place and
 * the live standings. At RACE OVER: the tag `RACE OVER`, why it ended, the final standings and the
 * `DAWN REPORT →` ink link to the results route. Rows are 7.4 roll rows: `01 · DESK 07` | the name
 * (text only, yours in the red text role with the `YOU` tag), the figure and the 7.4a status label.
 * Presentational: which rows and which figure are the caller's (`view/standings.ts`, ADR 0007). No
 * motion.
 */
export function FinishedView({ mode, value, rows, report, labels }: FinishedViewProps) {
  const title = mode === "ended" ? labels.over : labels.filed;
  return (
    <section aria-label={title} data-finished={mode} className={cn(docket.docket, styles.view)}>
      <div className={docket.head}>
        <span className={docket.tag}>{title}</span>
        {value === null ? null : <span className={docket.mono}>{value}</span>}
      </div>
      {rows.length > 0 ? (
        // scrolls inside itself past a few rows (30 desks), so it is focusable and named (bible 7.4)
        <ol aria-label={labels.standings} tabIndex={0} className={styles.rows}>
          {rows.map((r) => (
            <li
              key={r.desk}
              data-desk={r.desk}
              data-you={r.you || undefined}
              className={styles.row}
            >
              <span className={styles.id}>
                <span className={styles.place}>{paperwork(r.place)}</span>
                <span className={styles.desk}>{fill(labels.desk, { n: paperwork(r.desk) })}</span>
              </span>
              <span className={styles.main}>
                <span className={styles.name}>{r.name}</span>
                {r.you ? <span className={docket.tag}>{labels.you}</span> : null}
                <span className={styles.value}>{r.value}</span>
                {r.status === null ? null : (
                  <span data-status className={styles.status}>
                    {r.status}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {report === null ? null : (
        <div className={styles.actions}>
          <a href={report} className={docket.ink}>
            {labels.report}
          </a>
        </div>
      )}
    </section>
  );
}
