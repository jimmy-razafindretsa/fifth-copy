import { fill } from "@/i18n/format";
import type { NixieLabels } from "../view/hud-labels";
import styles from "./nixie-counters.module.css";

/** The WPM tube shows at most three digits (spec 6.1). */
export const NIXIE_WPM_MAX = 999;

/**
 * A count as nixie numerals: rounded, clamped to `0..max`, zero-padded to two digits (`04`); a number
 * that is not finite reads `00`. Display only: WPM and place are the engine's (ADR 0007, 0016).
 */
export function nixieNumber(n: number, max = Number.MAX_SAFE_INTEGER): string {
  const v = Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : 0;
  return String(v).padStart(2, "0");
}

/** Whole seconds as nixie clock numerals `mm:ss` (`01:00`, `00:59`); negative or not finite reads `00:00`. */
export function nixieClock(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export type NixieCountersProps = {
  /** Clean WPM (ADR 0016). */
  wpm: number;
  /** Your place, 1 = leading; `null` before the start (`00 / 30`). */
  place: number | null;
  /** Players in the race. */
  total: number;
  /** The timer's seconds left (#240, `selectRemaining`); `null` or absent: no timer, no third tube. */
  remainingS?: number | null;
  labels: NixieLabels;
};

/**
 * The race counters (#951 counter plate, was the #560 nixie tubes; bible 7.11, spec 6.1): one ink plate
 * with WPM, the place `3 / 6` and, when the host set a timer (#240), the time left `mm:ss`, as big
 * display figures. Read in words through the group's name; the glyphs are hidden.
 */
export function NixieCounters({
  wpm,
  place,
  total,
  remainingS = null,
  labels,
}: NixieCountersProps) {
  const shownWpm = nixieNumber(wpm, NIXIE_WPM_MAX);
  const time = remainingS === null ? null : nixieClock(remainingS);
  const words =
    (place === null
      ? fill(labels.ariaNoPlace, { wpm: Number(shownWpm), total })
      : fill(labels.aria, { wpm: Number(shownWpm), place, total })) +
    (time === null ? "" : fill(labels.ariaTime, { time }));
  return (
    <div
      data-device="nixie"
      data-timer={time === null ? undefined : ""}
      role="group"
      aria-label={words}
      className={styles.bezel}
    >
      <span className={styles.counter} aria-hidden="true">
        <span data-tube="wpm" className={styles.tube}>
          {shownWpm}
        </span>
        <span className={styles.tag}>{labels.wpm}</span>
      </span>
      <span className={styles.counter} aria-hidden="true">
        <span data-tube="place" className={styles.tube}>
          {place === null ? "–" : String(place)} <span className={styles.of}>{`/ ${total}`}</span>
        </span>
        <span className={styles.tag}>{labels.place}</span>
      </span>
      {time === null ? null : (
        <span className={styles.counter} aria-hidden="true">
          <span data-tube="timer" className={styles.tube}>
            {time}
          </span>
          <span className={styles.tag}>{labels.time}</span>
        </span>
      )}
    </div>
  );
}
