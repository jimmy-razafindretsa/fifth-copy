import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { keyAttributes, type MachineSkin, type MachineSkinProps } from "../skin";
import styles from "./teleprinter.module.css";

/** The in-world maker's plate on the top panel (bible 7.7a): never translated. */
export const MAKER_PLATE = "FIFTH COPY · MODEL 5";

const round = (n: number) => Math.round(n * 10) / 10;
/** The dial's ten finger holes in its 80-unit drawing: radius 29, every 30 degrees from 60 to 330. */
const HOLES = Array.from({ length: 10 }, (_, i) => {
  const a = ((60 + 30 * i) * Math.PI) / 180;
  return { cx: round(40 + 29 * Math.cos(a)), cy: round(40 - 29 * Math.sin(a)) };
});

/**
 * The compact teleprinter (#558, bible 7.7a, the owner's choice E4): a paper top panel with the ink slot
 * the typed sheet rises from, a tape reel, the maker's plate and a rotary dial, over a newsprint key deck
 * tilted away from the typist with square ink keys from `rows` and a space bar. Drawn in CSS and inline
 * SVG, sized from its own width; every state is an attribute set from props (`keyAttributes`, the frame's
 * `data-jammed`), so the motion of #224 hooks onto it without touching this module.
 */
function Teleprinter({ rows, jammed = false, ...state }: MachineSkinProps) {
  const deck = {
    "--_cols": Math.max(1, ...rows.map((row) => row.length)),
    "--_rows": Math.max(1, rows.length),
  } as CSSProperties;

  return (
    <div className={styles.machine}>
      <div className={styles.panel} data-part="panel">
        <span className={styles.slot} data-part="slot" />
        <span className={styles.stub} />
        <svg className={styles.reel} data-part="reel" viewBox="0 0 52 52" focusable="false">
          <circle className={styles.flange} cx="26" cy="26" r="25" />
          <circle className={styles.wound} cx="26" cy="26" r="17" />
          <circle className={styles.hub} cx="26" cy="26" r="5" />
        </svg>
        {jammed ? (
          // the printing point jams: a red X, so the jam reads without colour too
          <svg className={styles.jam} data-part="jam" viewBox="0 0 28 28" focusable="false">
            <line x1="3" y1="3" x2="25" y2="25" />
            <line x1="25" y1="3" x2="3" y2="25" />
          </svg>
        ) : null}
        <span className={cn(styles.plate, "type-label")} data-part="plate">
          {MAKER_PLATE}
        </span>
        <svg className={styles.dial} data-part="dial" viewBox="0 0 80 80" focusable="false">
          <circle className={styles.ring} cx="40" cy="40" r="37" />
          {HOLES.map(({ cx, cy }) => (
            <circle key={`${cx},${cy}`} className={styles.hole} cx={cx} cy={cy} r="5.5" />
          ))}
          <circle className={styles.hub} cx="40" cy="40" r="15" />
          <line className={styles.stop} x1="69" y1="29.4" x2="78" y2="26.2" />
        </svg>
      </div>
      <div className={styles.deck} data-part="deck" style={deck}>
        <div className={styles.bed}>
          {rows.map((row, r) => (
            <div key={r} className={styles.row} style={{ "--_row": r } as CSSProperties}>
              {row.map((key, c) => (
                <span key={`${r}-${c}`} className={styles.key} {...keyAttributes(key, state)}>
                  {key}
                </span>
              ))}
            </div>
          ))}
        </div>
        <span className={styles.space} {...keyAttributes(" ", state)} />
      </div>
    </div>
  );
}

export const teleprinter: MachineSkin<"teleprinter"> = { id: "teleprinter", Machine: Teleprinter };
