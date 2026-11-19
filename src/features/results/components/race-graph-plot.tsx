import type { CSSProperties, ReactNode } from "react";
import { formatRaceTime, PLOT_H, PLOT_W, type GraphMark, type PlotLine } from "../view/series";
import styles from "./race-graph.module.css";

/** A line's marker shape (spec 6.2, R80: shape plus name, colour never alone). */
export type LineShape = "circle" | "square" | "triangle" | "diamond";
/** A line's ink: a rival ink (`rival-0`..`rival-11`, bible 3.1) or `you`. */
export type LineInk = string;

/** One line as the plot and the toggle draw it, labels already filled. */
export type DrawnLine = PlotLine & {
  ink: LineInk;
  shape: LineShape;
  /** The toggle's text (`YOU`, or `№ 1 · Lynx-785 · 61 WPM`). */
  label: string;
  /** A bot's line: dashed, and its toggle carries the `SIMULATED` tag. */
  simulated: boolean;
};

/** The colour-blind-safe marker shapes in a 12-unit box (the race card's, bible 7.4a). */
const SHAPES: Record<LineShape, ReactNode> = {
  circle: <circle cx="6" cy="6" r="4.75" />,
  square: <rect x="1.25" y="1.25" width="9.5" height="9.5" />,
  triangle: <polygon points="6,0.75 11.25,10.75 0.75,10.75" />,
  diamond: <polygon points="6,0.5 11.5,6 6,11.5 0.5,6" />,
};

export function LineMarker({ shape, ink }: { shape: LineShape; ink: LineInk }) {
  return (
    <svg
      className={styles.marker}
      data-ink={ink}
      data-marker={shape}
      aria-hidden="true"
      viewBox="0 0 12 12"
      width="12"
      height="12"
      focusable="false"
    >
      {SHAPES[shape]}
    </svg>
  );
}

/**
 * The plot of the graph with other lines (#999 C52, bible 14.4 "WPM graph", "Other lines"), stateless:
 * the shown lines (`shown`, ids) each in its ink, the viewer's own the ink line on top with its bonus
 * ticks and names, an end marker per line in its shape. The scale and the time axis are shared.
 */
export function GraphPlot({
  yMax,
  endMs,
  marks,
  lines,
  shown,
  bonusNames,
  name,
  ownPoints = null,
}: {
  yMax: number;
  endMs: number;
  marks: readonly GraphMark[];
  lines: readonly DrawnLine[];
  shown: readonly string[];
  /** Each mark's tray name. */
  bonusNames: Record<string, string>;
  /** The image's accessible name. */
  name: string;
  /** The viewer's own stored points, carried as `data-points` while their line is shown. */
  ownPoints?: number | null;
}) {
  const visible = new Set(shown);
  const drawn = lines.filter((l) => visible.has(l.id));
  const own = drawn.find((l) => l.ink === "you");
  const rivals = drawn.filter((l) => l !== own);
  const ticks = own ? marks : [];
  const lanes = { "--lanes": ticks.length } as CSSProperties;
  return (
    <div
      className={styles.chart}
      style={lanes}
      data-lines={drawn.length}
      data-points={own && ownPoints !== null ? ownPoints : undefined}
    >
      <div className={styles.scale} aria-hidden="true">
        <span data-scale="top">{yMax}</span>
        <span data-scale="bottom">0</span>
      </div>
      {ticks.length > 0 && (
        <ol className={styles.names} aria-hidden="true">
          {ticks.map((m) => (
            <li
              key={`${m.t}:${m.kind}:${m.lane}`}
              className={styles.name}
              style={{ "--x": m.x, "--lane": m.lane } as CSSProperties}
              data-kind={m.kind}
            >
              <span className={styles.nameText}>{bonusNames[m.kind]}</span>
            </li>
          ))}
        </ol>
      )}
      <svg
        className={styles.plot}
        role="img"
        aria-label={name}
        viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
        preserveAspectRatio="none"
        focusable="false"
      >
        {ticks.map((m) => (
          <line
            key={`${m.t}:${m.kind}:${m.lane}`}
            className={styles.tick}
            x1={m.x * PLOT_W}
            x2={m.x * PLOT_W}
            y1={0}
            y2={PLOT_H}
            data-mark={m.kind}
          />
        ))}
        {rivals.map((l) => (
          <polyline
            key={l.id}
            className={styles.rival}
            points={l.line}
            data-line-desk={l.id}
            data-ink={l.ink}
            data-simulated={l.simulated ? "true" : undefined}
          />
        ))}
        {own && <polyline className={styles.line} points={own.line} data-line />}
      </svg>
      <div className={styles.ends} aria-hidden="true">
        {drawn.map((l) => (
          <span
            key={l.id}
            className={styles.end}
            style={{ "--x": l.end.x, "--y": l.end.y } as CSSProperties}
            data-end={l.id}
          >
            <LineMarker shape={l.shape} ink={l.ink} />
          </span>
        ))}
      </div>
      <div className={styles.time} aria-hidden="true">
        <span>{formatRaceTime(0)}</span>
        <span data-time="end">{formatRaceTime(endMs)}</span>
      </div>
    </div>
  );
}

/**
 * The player toggle (#999 C52): a fieldset of real checkboxes (bible 7.2 checkbox row), one per line in
 * the graph's order, each its marker then its label; several at once; keyboard by nature (Tab, Space).
 */
export function LineToggle({
  legend,
  simulated,
  lines,
  shown,
  onToggle,
  idPrefix,
}: {
  legend: string;
  simulated: string;
  lines: readonly DrawnLine[];
  shown: readonly string[];
  onToggle?: (id: string, checked: boolean) => void;
  idPrefix: string;
}) {
  const visible = new Set(shown);
  return (
    <fieldset className={styles.toggle} data-toggle>
      <legend className={styles.legend}>{legend}</legend>
      <ul className={styles.choices}>
        {lines.map((l) => (
          <li key={l.id}>
            <label className={styles.choice} htmlFor={`${idPrefix}-${l.id}`}>
              <input
                id={`${idPrefix}-${l.id}`}
                type="checkbox"
                checked={visible.has(l.id)}
                onChange={(e) => onToggle?.(l.id, e.target.checked)}
                readOnly={!onToggle}
                data-line-choice={l.id}
              />
              <LineMarker shape={l.shape} ink={l.ink} />
              <span className={styles.choiceText}>{l.label}</span>
              {l.simulated && <span className={styles.simulated}>{simulated}</span>}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
