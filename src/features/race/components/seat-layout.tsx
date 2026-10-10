import type { ReactNode } from "react";
import styles from "./seat-layout.module.css";

export type SeatLayoutProps = {
  /** The page heading (the kicker). */
  kicker: ReactNode;
  /** Top right (bible 7.11). */
  nixie: ReactNode;
  /** Across the top (bible 7.7). */
  telex: ReactNode;
  /** The left gutter (bible 7.4a), never over the machine. */
  raceCard: ReactNode;
  /** The live state above the typing surface: skeleton, notices, the lost line. */
  status: ReactNode;
  /** The typed sheet, rising out of the machine's slot (bible 7.7a). */
  sheet: ReactNode;
  /** The typing machine at the bottom (bible 7.7a). */
  machine: ReactNode;
  /** The right gutter: the Sabotage tray (bible 7.4)... */
  tray: ReactNode;
  /** ...and Abandon under it, always visible (bible 7.1). */
  abandon: ReactNode;
  /** The only thing phones see (<= 480 px). */
  phones: string;
};

/**
 * The seat view's HTML layer (#561, design bible 14.3, 7.10): the HUD over the flat paper backdrop, which
 * is also the race view when there is no 3D scene (ADR 0013 fallback; the scene mounts behind the HUD in
 * #563). Desktop and laptop: the race card in the left gutter, the typing surface in the middle column at
 * the bottom, the tray and Abandon in the right gutter, the telex across the top and the nixie counters top
 * right. Tablets: the card and the tray share a row above the typing surface. Phones: only the notice.
 * Presentational: every part arrives as a slot.
 */
export function SeatLayout(props: SeatLayoutProps) {
  return (
    <div data-seat data-backdrop="paper" className={styles.seat}>
      <div data-hud className={styles.hud}>
        <div className={styles.kicker}>{props.kicker}</div>
        <div className={styles.nixie}>{props.nixie}</div>
        <div className={styles.telex}>{props.telex}</div>
        <div className={styles.left}>{props.raceCard}</div>
        <div className={styles.center}>
          <div data-seat-status className={styles.status}>
            {props.status}
          </div>
          <div className={styles.surface}>
            {/* bible 7.7a: the sheet (61.3% of the machine) rises out of the slot; the machine, later in
                the DOM, paints over its bottom 22 machine units (3.55% of the machine's width) */}
            <div className={styles.sheet}>{props.sheet}</div>
            {props.machine}
          </div>
        </div>
        <div className={styles.right}>
          {props.tray}
          <div className={styles.abandon}>{props.abandon}</div>
        </div>
      </div>
      <p data-phones className={styles.phones}>
        {props.phones}
      </p>
    </div>
  );
}
