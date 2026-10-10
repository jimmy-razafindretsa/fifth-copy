import { fill } from "@/i18n/format";
import { cn } from "@/lib/cn";
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

export type NixieCountersProps = {
  /** Clean WPM (ADR 0016). */
  wpm: number;
  /** Your place, 1 = leading; `null` before the start (`00 / 30`). */
  place: number | null;
  /** Players in the race. */
  total: number;
  labels: NixieLabels;
};

/**
 * The nixie counters (#560, design bible 7.11, spec 6.1): a device bezel (6 device glow: backroom-grey
 * frame, press-ink interior) holding two glass tubes, WPM and place `04 / 30`, in VT323 nixie numerals.
 * The glow lights only the tubes (the scoped `device-nixie` utility plus the tube's inner glow); the tags
 * are paper label text without glow. Read in words through the group's name; the glyphs are hidden.
 */
export function NixieCounters({ wpm, place, total, labels }: NixieCountersProps) {
  const shownWpm = nixieNumber(wpm, NIXIE_WPM_MAX);
  const words =
    place === null
      ? fill(labels.ariaNoPlace, { wpm: Number(shownWpm), total })
      : fill(labels.aria, { wpm: Number(shownWpm), place, total });
  return (
    <div data-device="nixie" role="group" aria-label={words} className={styles.bezel}>
      <span className={styles.counter} aria-hidden="true">
        <span data-tube="wpm" className={cn(styles.tube, "type-device device-nixie")}>
          {shownWpm}
        </span>
        <span className={styles.tag}>{labels.wpm}</span>
      </span>
      <span className={styles.counter} aria-hidden="true">
        <span data-tube="place" className={cn(styles.tube, "type-device device-nixie")}>
          {`${nixieNumber(place ?? 0)} / ${nixieNumber(total)}`}
        </span>
        <span className={styles.tag}>{labels.place}</span>
      </span>
    </div>
  );
}
