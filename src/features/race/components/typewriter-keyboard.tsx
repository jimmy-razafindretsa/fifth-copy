import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import styles from "./typewriter-keyboard.module.css";

/** The in-world nameplate on the front of the machine (bible 7.7a): never translated. */
export const MAKER_PLATE = "FIFTH COPY · MODEL 5";

/** The rear of the machine in a 100-unit-wide drawing (bible 7.7a proportions, from the Full Lobby desk). */
const BASKET = { cx: 50, cy: 30, r: 18 } as const;
/** Thin radial type bars of the basket: 23 between 10 and 170 degrees, from the hub to the rim. */
const BARS = Array.from({ length: 23 }, (_, i) => {
  const a = ((10 + (160 * i) / 22) * Math.PI) / 180;
  const at = (r: number) => ({
    x: Math.round((BASKET.cx + r * Math.cos(a)) * 100) / 100,
    y: Math.round((BASKET.cy - r * Math.sin(a)) * 100) / 100,
  });
  return { from: at(5), to: at(16.5) };
});

type Props = {
  /** The keys, row by row from the back (the number row) to the front; a layout is just data (#224). */
  rows: readonly (readonly string[])[];
  /** The key down right now. */
  pressed?: string | null;
  /** The key just struck wrong: its cell reads red. */
  wrong?: string | null;
  /** Block mode refused a key: the key bar, the rings and the type bars read red. */
  jammed?: boolean;
  /** Keys that do nothing right now (dashed ring, muted legend). */
  disabledKeys?: readonly string[];
};

const flag = (on: boolean) => (on ? "true" : undefined);

/**
 * The typewriter keyboard (#558, bible 7.7a, 11.1): a dark green machine with round cream keys in chrome
 * rings, a type-bar basket, two ribbon spools, the platen and the maker's plate, drawn in CSS and inline
 * SVG from the `rows` it is given. Every state is an attribute driven only by props; the whole machine is
 * decoration (`aria-hidden`): the text and its states reach assistive tech through the race HUD.
 */
export function TypewriterKeyboard({
  rows,
  pressed = null,
  wrong = null,
  jammed = false,
  disabledKeys = [],
}: Props) {
  const disabled = new Set(disabledKeys);
  const bed = {
    "--_cols": Math.max(1, ...rows.map((row) => row.length)),
    "--_rows": Math.max(1, rows.length),
  } as CSSProperties;

  return (
    <div className={styles.typewriter} data-typewriter aria-hidden="true" data-jammed={flag(jammed)}>
      <svg className={styles.rear} viewBox="0 0 100 30" focusable="false">
        <rect className={styles.housing} x="11" y="5" width="78" height="25" />
        {[16, 84].map((x) => (
          <g key={x} data-part="spool" transform={`translate(${x} 16)`}>
            <circle className={styles.flange} r="6" />
            <circle className={styles.ribbon} r="4.3" />
            <circle className={styles.hub} r="1.5" />
          </g>
        ))}
        <g data-part="basket">
          <path
            className={styles.basket}
            d={`M${BASKET.cx - BASKET.r} ${BASKET.cy} A${BASKET.r} ${BASKET.r} 0 0 1 ${BASKET.cx + BASKET.r} ${BASKET.cy} Z`}
          />
          {BARS.map(({ from, to }) => (
            <line
              key={`${to.x},${to.y}`}
              className={styles.bar}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
            />
          ))}
        </g>
        {jammed ? (
          // two type bars stuck together at the printing point: the jam reads without colour too
          <g data-part="jam">
            <line className={styles.jam} x1="45" y1="17" x2="52" y2="5.5" />
            <line className={styles.jam} x1="55" y1="17" x2="48" y2="5.5" />
          </g>
        ) : null}
        <g data-part="platen">
          <rect className={styles.knob} x="0.5" y="0" width="6" height="8" rx="1.5" />
          <rect className={styles.knob} x="93.5" y="0" width="6" height="8" rx="1.5" />
          <rect className={styles.roller} x="6" y="0.5" width="88" height="7" rx="3.5" />
          <line className={styles.bail} x1="12" y1="6" x2="88" y2="6" />
        </g>
      </svg>
      <div className={styles.body}>
        <div className={styles.bed} style={bed}>
          {rows.map((row, r) => (
            <div key={r} className={styles.row} style={{ "--_row": r } as CSSProperties}>
              {row.map((key, c) => (
                <span
                  key={`${r}-${c}`}
                  role="presentation"
                  className={styles.key}
                  data-key={key}
                  data-pressed={flag(key === pressed)}
                  data-wrong={flag(key === wrong)}
                  data-disabled={flag(disabled.has(key))}
                >
                  {key}
                </span>
              ))}
            </div>
          ))}
        </div>
        <span className={styles.keybar} data-part="keybar" />
        <span className={cn(styles.plate, "type-label text-xs")} data-part="plate">
          {MAKER_PLATE}
        </span>
      </div>
    </div>
  );
}
