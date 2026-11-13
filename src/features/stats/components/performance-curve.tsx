"use client";

import { useId, useState } from "react";
import type { Messages } from "@/i18n";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import { cn } from "@/lib/cn";
import {
  accuracyTickLabels,
  type CurvePoint,
  type CurveSeries,
  curveSummary,
  GRID_LINES,
  PLOT,
  performanceCurve,
  SMOOTHING,
  speedTickLabels,
} from "../view/performance-curve";
import styles from "./performance-curve.module.css";

export type PerformanceCurveLabels = Messages["profile"]["curve"];

export type PerformanceCurveProps = {
  /** The latest counted races, oldest first (`Profile.progress.series`, at most the 40 drawn). */
  points: CurvePoint[];
  labels: PerformanceCurveLabels;
  locale: Locale;
};

/**
 * The output curve's frame (#933, bible 14.3, `Profil.dc.html` `COURBE DE RENDEMENT`): the speed ticks,
 * one inline SVG (ADR 0013: no canvas, no chart library), the accuracy ticks, then the `LISSAGE` slider
 * and the legend. The one client leaf of the section: it owns the smoothing width; the server render
 * already draws it at 3. Geometry comes from the pure `view/performance-curve`.
 */
export function PerformanceCurve(props: PerformanceCurveProps) {
  const [smoothing, setSmoothing] = useState<number>(SMOOTHING.initial);
  return <CurveFrame {...props} smoothing={smoothing} onSmoothing={setSmoothing} />;
}

/** The frame at a given smoothing width: stateless, so the server and the tests draw it as is. */
export function CurveFrame({
  points,
  labels,
  locale,
  smoothing,
  onSmoothing,
}: PerformanceCurveProps & { smoothing: number; onSmoothing?: (k: number) => void }) {
  const sliderId = useId();
  const curve = performanceCurve(points, smoothing);
  if (!curve) return null;
  const summary = fill(labels.summary, {
    ...curveSummary(curve, locale),
    trend: curve.trend ? labels.trend[curve.trend.direction] : "",
  });
  // the unit labels sit above or below their line's end, the higher line's above, so they never meet
  const speedAbove = curve.speed.end.y <= curve.accuracy.end.y;

  return (
    <div className={styles.frame} data-curve="" data-curve-count={curve.count}>
      <div className={styles.plotRow}>
        <Ticks
          labels={speedTickLabels(curve.speed.scale)}
          className={styles.ticksLeft}
          swatch={styles.speedSwatch}
        />
        <div className={styles.plot}>
          <svg
            viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
            role="img"
            aria-label={summary}
            className={styles.svg}
          >
            <g className={styles.grid}>
              {GRID_LINES.map((y) => (
                <line key={y} x1={0} x2={PLOT.width} y1={y} y2={y} />
              ))}
            </g>
            <path d={curve.accuracy.dots} className={cn(styles.dots, styles.accuracyDots)} />
            <path
              d={curve.accuracy.line}
              className={cn(styles.line, styles.accuracyLine)}
              data-curve-line="accuracy"
            />
            <path d={curve.speed.dots} className={cn(styles.dots, styles.speedDots)} />
            <path
              d={curve.speed.line}
              className={cn(styles.line, styles.speedLine)}
              data-curve-line="speed"
            />
            {curve.trend ? (
              <path d={curve.trend.path} className={styles.trend} data-curve-line="trend" />
            ) : null}
          </svg>
          <EndLabel series={curve.speed} text={labels.units.speed} above={speedAbove} />
          <EndLabel series={curve.accuracy} text={labels.units.accuracy} above={!speedAbove} />
        </div>
        <Ticks
          labels={accuracyTickLabels(curve.accuracy.scale, locale)}
          className={styles.ticksRight}
          swatch={styles.accuracySwatch}
        />
      </div>

      <div className={styles.controls}>
        <div className={styles.smoothing}>
          <label htmlFor={sliderId}>{labels.smoothing}</label>
          <input
            id={sliderId}
            type="range"
            min={SMOOTHING.min}
            max={SMOOTHING.max}
            step={1}
            value={smoothing}
            onChange={(e) => onSmoothing?.(Number(e.target.value))}
            className={styles.slider}
            data-curve-smoothing=""
          />
          <span className={styles.value} aria-hidden="true" data-curve-value="">
            {smoothing}
          </span>
        </div>
        <ul className={styles.legend}>
          <li>
            <i className={cn(styles.swatch, styles.speedSwatch)} aria-hidden="true" />
            {labels.legend.speed}
          </li>
          <li>
            <i className={cn(styles.swatch, styles.accuracySwatch)} aria-hidden="true" />
            {labels.legend.accuracy}
          </li>
          {curve.trend ? (
            <li>
              <i className={styles.trendSwatch} aria-hidden="true" />
              {labels.legend.trend}
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

/**
 * A tick column: five values spread top to bottom, the series' swatch beside the top one (violet and red
 * are marks, not text, bible 3.3); the SVG's name carries the figures.
 */
function Ticks({
  labels,
  className,
  swatch,
}: {
  labels: string[];
  className: string;
  swatch: string;
}) {
  return (
    <div className={cn(styles.ticks, className)} aria-hidden="true">
      {labels.map((label, i) => (
        <span key={i}>
          {i === 0 ? <i className={cn(styles.tickSwatch, swatch)} /> : null}
          {label}
        </span>
      ))}
    </div>
  );
}

/** The unit beside a smoothed line's latest point (C5: the series are told apart without colour). */
function EndLabel({ series, text, above }: { series: CurveSeries; text: string; above: boolean }) {
  return (
    <span
      className={cn(styles.endLabel, above ? styles.endAbove : styles.endBelow)}
      style={{
        left: `${(series.end.x / PLOT.width) * 100}%`,
        top: `${(series.end.y / PLOT.height) * 100}%`,
      }}
      aria-hidden="true"
      data-curve-end=""
    >
      {text}
    </span>
  );
}
