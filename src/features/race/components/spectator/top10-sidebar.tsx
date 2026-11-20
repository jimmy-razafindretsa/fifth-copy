import { fill } from "@/i18n/format";
import { cn } from "@/lib/cn";
import type { TopTenRow } from "../../view/standings";
import docket from "../hud-docket.module.css";
import { IdentityMarker } from "../race-card";
import styles from "./top10-sidebar.module.css";

/** The `race.projector` copy (#999, bible 14.3 "Projector view"). */
export type ProjectorLabels = {
  /** The page's one heading: `PROJECTOR VIEW` / `VUE PROJECTEUR`. */
  kicker: string;
  /** The connecting skeleton's name. */
  connecting: string;
  /** The sidebar's ink tag: `TOP 10`. */
  top: string;
  /** The sidebar's mono value: `{n} TYPISTS`. */
  typists: string;
  /** The list's accessible name. */
  standings: string;
  /** The place cell before the first snapshot (no rank yet); a plaque's too. */
  noPlace: string;
  /** The overview scene frame's name (#999 C2). */
  scene: string;
  /** A rank plaque's desk (#999 C4): `DESK {n}`. */
  plaqueDesk: string;
};

export type Top10SidebarProps = {
  /** At most 10 (`topTenRows`), in place order. */
  rows: readonly TopTenRow[];
  /** Typists in the room (the roster), for the header value. */
  count: number;
  labels: ProjectorLabels;
  /**
   * #999 C10: the phone spectator's scale (bible 14.3 "Phone spectator"): the finished view's roll-row
   * sizes (15px rows, 13px header) instead of the projector's.
   */
  compact?: boolean;
};

const two = (n: number) => String(n).padStart(2, "0");

/**
 * The projector's top-10 sidebar (#999 C3, bible 14.3 "Projector view", 7.4, 7.4a): one 7.4 docket, the
 * ink tag `TOP 10` and `12 TYPISTS` in its header, then at most 10 rows at the projector scale (28px at
 * 1080p): the place, the desk's rival marker (shape in its ink, #565), the name as text, and the figure
 * (the status word when the desk is not typing). Never a `you`: the projector holds no desk. Never a
 * scroll, no motion. Presentational: the rows are `topTenRows`' (ADR 0007).
 */
export function Top10Sidebar({ rows, count, labels, compact = false }: Top10SidebarProps) {
  return (
    <section
      aria-label={labels.top}
      data-top10
      className={cn(docket.docket, styles.sidebar, compact && styles.compact)}
    >
      <div className={styles.head}>
        <span className={styles.tag}>{labels.top}</span>
        <span className={styles.count}>{fill(labels.typists, { n: count })}</span>
      </div>
      {rows.length > 0 ? (
        <ol aria-label={labels.standings} className={styles.rows}>
          {rows.map((r) => (
            <li
              key={r.desk}
              data-desk={r.desk}
              data-place={r.place ?? undefined}
              className={styles.row}
            >
              <span className={styles.place}>
                {r.place === null ? labels.noPlace : two(r.place)}
              </span>
              <span className={styles.mark}>
                <IdentityMarker shape={r.marker.shape} ink={r.marker.colour} />
              </span>
              <span className={styles.name}>{r.name}</span>
              {r.status !== null ? (
                <span data-status className={styles.status}>
                  {r.status}
                </span>
              ) : r.value !== null ? (
                <span className={styles.value}>{r.value}</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
