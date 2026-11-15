import { cn } from "@/lib/cn";
import styles from "./device-tube.module.css";

export type DeviceTubeProps = {
  /** The numerals as drawn (`42`, `96.1`, `--`). */
  value: string;
  /** The tag under the tube (`AVG WPM` / `MPM MOY.`). */
  tag: string;
  /** What a screen reader hears instead of the glyphs (`Average WPM: 42`). */
  spoken: string;
  className?: string;
};

/**
 * One counter plate (#951, bible 7.11 "Counter plates"; was the #932 nixie tube): a paper plate with an
 * ink rule and a 4px print offset, big display numerals and the tag under a rule. The glyphs are hidden;
 * `spoken` is read instead. The seat view's counters are their own ink plate (`NixieCounters`).
 */
export function DeviceTube({ value, tag, spoken, className }: DeviceTubeProps) {
  return (
    <div data-device="plate" className={cn(styles.bezel, className)}>
      <span className="sr-only">{spoken}</span>
      <span
        aria-hidden="true"
        data-tube=""
        className={styles.tube}
      >
        {value}
      </span>
      <span aria-hidden="true" className={styles.tag}>
        {tag}
      </span>
    </div>
  );
}
