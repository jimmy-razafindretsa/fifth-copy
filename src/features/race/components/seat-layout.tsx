import type { ComponentType, ReactNode } from "react";
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
  /**
   * The 3D scene (#563): its layer fills the screen behind the HUD; its loading card or `no-scene` notice
   * sits at the top of the middle column, above the live state, never over the strip or the sheet.
   */
  scene?: ReactNode;
  /** The typed sheet, rising out of the machine's slot (bible 7.7a). */
  sheet: ReactNode;
  /** The typing machine at the bottom (bible 7.7a). */
  machine: ReactNode;
  /** The right gutter: the Sabotage tray (bible 7.4)... */
  tray: ReactNode;
  /** ...and Abandon under it, always visible (bible 7.1). */
  abandon: ReactNode;
  /** ...and the sound toggle under Abandon (#243, bible 7.1). */
  sound?: ReactNode;
  /** The only thing phones see (<= 480 px). */
  phones: string;
  /**
   * The root element (#251): the seat view passes its client frame, which adds `data-osk` and
   * `data-orientation`; a plain `div` otherwise (the design page's specimens).
   */
  frame?: ComponentType<SeatFrameProps>;
};

/** What the root element of the seat view takes. */
export type SeatFrameProps = { className?: string; children: ReactNode };

function PlainFrame({ className, children }: SeatFrameProps) {
  return (
    <div data-seat data-backdrop="paper" className={className}>
      {children}
    </div>
  );
}

/**
 * The seat view's HTML layer (#561, design bible 14.3, 7.10): the HUD over the flat paper backdrop, which
 * is also the race view when there is no 3D scene (ADR 0013 fallback; the scene mounts behind the HUD,
 * #563). Desktop and laptop: the race card in the left gutter, the typing surface in the middle column at
 * the bottom, the tray and Abandon in the right gutter, the telex across the top and the nixie counters top
 * right. Tablets: the card and the tray share a row above the typing surface; under an on-screen keyboard
 * (`data-osk="open"`, #251) the machine folds away and the strip and the sheet move up under the kicker.
 * Phones: only the notice.
 * Presentational: every part arrives as a slot.
 */
export function SeatLayout(props: SeatLayoutProps) {
  const Frame = props.frame ?? PlainFrame;
  return (
    <Frame className={styles.seat}>
      <div data-hud className={styles.hud}>
        <div className={styles.kicker}>{props.kicker}</div>
        <div className={styles.nixie}>{props.nixie}</div>
        <div className={styles.telex}>{props.telex}</div>
        <div className={styles.left}>{props.raceCard}</div>
        <div className={styles.center}>
          {props.scene ? (
            <div data-seat-scene className={styles.scene}>
              {props.scene}
            </div>
          ) : null}
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
          {props.sound ? <div className={styles.sound}>{props.sound}</div> : null}
        </div>
      </div>
      <p data-phones className={styles.phones}>
        {props.phones}
      </p>
    </Frame>
  );
}
