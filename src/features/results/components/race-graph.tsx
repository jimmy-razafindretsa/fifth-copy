import type { CSSProperties } from "react";
import { fill } from "@/i18n/format";
import { formatWpm } from "../view/dawn-report";
import type { PersonalLabels } from "../view/report-labels";
import {
  formatRaceTime,
  graphGeometry,
  PLOT_H,
  PLOT_W,
  seriesSummary,
  type RaceSeries,
} from "../view/series";
import styles from "./race-graph.module.css";

export type RaceGraphProps = { series: RaceSeries | null; labels: PersonalLabels };

/** The sentence that names the graph: peak and final WPM (whole, as the card shows them), bonuses. */
export function graphName(series: RaceSeries, labels: PersonalLabels): string {
  const { peak, final, bonuses } = seriesSummary(series);
  const { summary } = labels.graph;
  const template = bonuses === 0 ? summary.zero : bonuses === 1 ? summary.one : summary.other;
  return fill(template, { peak: formatWpm(peak), final: formatWpm(final), n: bonuses });
}

/**
 * The personal card's WPM graph (#865, spec 11.3, R141; bible 14.4 "Personal stats card", 3, 8): a
 * section of the card under the bonus rows, presentational. The viewer's clean WPM through the race
 * (the engine's `wpmSeries`, ADR 0007) as one ink polyline on a paper plot, the WPM scale left (0 and
 * the scale's top) and the race time under it (`0:00` to the end); each bonus received is a dashed red
 * tick across the plot with its Sabotage tray name above it, one lane per hit. Inline SVG (ADR 0013), no
 * dependency, no motion, no gold. The SVG is the image (`role="img"`, named by one sentence: peak,
 * final, bonuses received); the scale, times and names beside it are hidden from assistive tech, the
 * card's `RECEIVED` row lists the names. `null` (no keystroke row: purged, a bot, never typed) reads
 * `NO TRACE ON FILE`.
 */
export function RaceGraph({ series, labels }: RaceGraphProps) {
  return (
    <div className={styles.graph} data-section="graph">
      <h3 className={styles.title}>{labels.graph.title}</h3>
      {series === null ? (
        <p className={styles.none} data-no-trace>
          {labels.graph.noTrace}
        </p>
      ) : (
        <Chart series={series} labels={labels} />
      )}
    </div>
  );
}

function Chart({ series, labels }: { series: RaceSeries; labels: PersonalLabels }) {
  const { yMax, line, marks } = graphGeometry(series);
  const lanes = { "--lanes": marks.length } as CSSProperties;
  return (
    <div className={styles.chart} style={lanes} data-points={series.points.length}>
      <div className={styles.scale} aria-hidden="true">
        <span data-scale="top">{yMax}</span>
        <span data-scale="bottom">0</span>
      </div>
      {marks.length > 0 && (
        <ol className={styles.names} aria-hidden="true">
          {marks.map((m) => (
            <li
              key={`${m.t}:${m.kind}:${m.lane}`}
              className={styles.name}
              style={{ "--x": m.x, "--lane": m.lane } as CSSProperties}
              data-kind={m.kind}
            >
              <span className={styles.nameText}>{labels.bonus[m.kind]}</span>
            </li>
          ))}
        </ol>
      )}
      <svg
        className={styles.plot}
        role="img"
        aria-label={graphName(series, labels)}
        viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
        preserveAspectRatio="none"
        focusable="false"
      >
        <line className={styles.top} x1={0} y1={0} x2={PLOT_W} y2={0} />
        {marks.map((m) => (
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
        <polyline className={styles.line} points={line} data-line />
      </svg>
      <div className={styles.time} aria-hidden="true">
        <span>{formatRaceTime(0)}</span>
        <span data-time="end">{formatRaceTime(series.endMs)}</span>
      </div>
    </div>
  );
}
