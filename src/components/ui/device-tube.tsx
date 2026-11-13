import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import styles from "./device-tube.module.css";

/** The glass: a rim and an inner glow in the nixie glow (bible 7.11), lit numerals via `device-nixie`. */
const GLASS: CSSProperties = {
  borderColor: "var(--color-device-nixie-glow)",
  background: "var(--color-device-bezel)",
  boxShadow: "inset 0 0 12px var(--color-device-nixie-glow)",
};

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
 * One nixie tube in its own device bezel (#932, bible 7.11 "Personnel file tubes"): a press-ink bezel
 * with a backroom rule and a 4px print offset, the glass tube with `type-device` numerals lit by the
 * scoped `device-nixie` glow, and the tag under it. The glyphs are hidden; `spoken` is read instead.
 * The seat view's counters keep their own shared bezel (`NixieCounters`).
 */
export function DeviceTube({ value, tag, spoken, className }: DeviceTubeProps) {
  return (
    <div data-device="nixie" className={cn(styles.bezel, "bg-device-bezel", className)}>
      <span className="sr-only">{spoken}</span>
      <span
        aria-hidden="true"
        data-tube=""
        className={cn(styles.tube, "type-device device-nixie")}
        style={GLASS}
      >
        {value}
      </span>
      <span aria-hidden="true" className={styles.tag}>
        {tag}
      </span>
    </div>
  );
}
