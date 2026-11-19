import type { CSSProperties } from "react";
import { fill } from "@/i18n/format";
import { identityOfDesk } from "@/lib/rival-identity";
import { formatWpm } from "../view/dawn-report";
import type { PersonalLabels } from "../view/report-labels";
import {
  formatRaceTime,
  graphGeometry,
  PLOT_H,
  PLOT_W,
  defaultLines,
  hasTypistLine,
  plotOf,
  seriesSummary,
  YOU_LINE,
  type RaceLine,
  type RaceSeries,
} from "../view/series";
import styles from "./race-graph.module.css";
import { RaceGraphLines } from "./race-graph-lines";
import type { DrawnLine } from "./race-graph-plot";

export type RaceGraphProps = {
  series: RaceSeries | null;
  labels: PersonalLabels;
  /**
   * The other desks' lines (#999 C52, `getRaceSeriesForAll`: empty outside the race's audience). Left
   * out or empty, the graph is the viewer's own line alone (#865).
   */
  others?: readonly RaceLine[];
  /** The viewer's desk (`null` for a watching host): their marker is `you`, every other a rival ink. */
  viewerDesk?: number | null;
  /** The ranking's last place: its line is drawn first, with the viewer's and the winner's. */
  lastPlace?: number;
};

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
export function RaceGraph({
  series,
  labels,
  others = [],
  viewerDesk = null,
  lastPlace = 0,
}: RaceGraphProps) {
  const compare = hasTypistLine(others);
  return (
    <div className={styles.graph} data-section="graph">
      <h3 className={styles.title}>{labels.graph.title}</h3>
      {compare ? (
        <>
          {series === null && viewerDesk !== null && (
            <p className={styles.none} data-no-trace>
              {labels.graph.noTrace}
            </p>
          )}
          <Compared
            series={series}
            labels={labels}
            others={others}
            viewerDesk={viewerDesk}
            lastPlace={lastPlace}
          />
        </>
      ) : series === null ? (
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

/**
 * The graph with other lines (#999 C52, ADR 0027): every line placed on one scale here, on the server
 * (`plotOf`); each desk's marker and ink are the desk allocator's (`identityOfDesk`, bible 3.1), the
 * viewer's own `you`. The client leaf only holds which lines are shown.
 */
function Compared({
  series,
  labels,
  others,
  viewerDesk,
  lastPlace,
}: Required<Omit<RaceGraphProps, "series">> & { series: RaceSeries | null }) {
  const plot = plotOf(series, others);
  const byId = new Map(others.map((l) => [String(l.desk), l]));
  const lines: DrawnLine[] = plot.lines.map((p) => {
    const other = byId.get(p.id);
    const desk = p.id === YOU_LINE ? (viewerDesk ?? 0) : (other?.desk ?? 0);
    const identity = identityOfDesk(desk, new Map(), p.id === YOU_LINE ? desk : viewerDesk);
    return {
      ...p,
      ink: p.id === YOU_LINE ? "you" : identity.colour === "you" ? "rival-0" : identity.colour,
      shape: identity.shape,
      label: other
        ? fill(labels.graph.line, {
            place: other.place,
            name: other.name,
            wpm: formatWpm(other.wpm),
          })
        : labels.graph.you,
      simulated: !!other?.isBot,
    };
  });
  return (
    <RaceGraphLines
      yMax={plot.yMax}
      endMs={plot.endMs}
      marks={plot.marks}
      lines={lines}
      initial={defaultLines(series !== null, others, lastPlace)}
      ownPoints={series ? series.points.length : null}
      bonusNames={labels.bonus}
      ownName={series ? graphName(series, labels) : ""}
      othersName={labels.graph.others}
      legend={labels.graph.lines}
      simulated={labels.graph.simulated}
    />
  );
}
