import type { CSSProperties } from "react";
import { fill } from "@/i18n/format";
import { cn } from "@/lib/cn";
import type { RaceCardLabels } from "../view/hud-labels";
import type { Lane, MarkerShape, RaceCardView } from "../view/race-card-view";
import docket from "./hud-docket.module.css";
import styles from "./race-card.module.css";

/** Progress as a 0..1 fraction (a display guard; the value is the engine's, ADR 0007). */
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const percent = (n: number) => Math.round(clamp01(n) * 100);
/** The track position as a private custom property (no inline colour: tokens-only). */
const at = (progress: number) => ({ "--_p": clamp01(progress) }) as CSSProperties;
const desk = (labels: RaceCardLabels, n: number) =>
  fill(labels.desk, { n: String(n).padStart(2, "0") });

/** The colour-blind-safe marker shapes (spec 6.2, R80) in a 12-unit box; ink comes from the lane. */
const SHAPES: Record<MarkerShape, React.ReactNode> = {
  circle: <circle cx="6" cy="6" r="4.75" />,
  square: <rect x="1.25" y="1.25" width="9.5" height="9.5" />,
  triangle: <polygon points="6,0.75 11.25,10.75 0.75,10.75" />,
  diamond: <polygon points="6,0.5 11.5,6 6,11.5 0.5,6" />,
};

function Marker({ shape }: { shape: MarkerShape }) {
  return (
    <svg
      data-marker={shape}
      aria-hidden="true"
      viewBox="0 0 12 12"
      width="12"
      height="12"
      className={styles.marker}
    >
      {SHAPES[shape]}
    </svg>
  );
}

function LaneRow({
  lane,
  labels,
  compact,
}: {
  lane: Lane;
  labels: RaceCardLabels;
  compact: boolean;
}) {
  const status = lane.status === "typing" ? null : labels.status[lane.status];
  const words = fill(labels.lane, {
    rank: lane.rank,
    name: lane.name,
    you: lane.you ? `, ${labels.you}` : "",
    desk: String(lane.desk).padStart(2, "0"),
    progress: percent(lane.progress),
    status: status ? `, ${status}` : "",
  });
  return (
    <li
      data-lane
      data-desk={lane.desk}
      data-status={lane.status}
      data-you={lane.you || undefined}
      data-ink={lane.you ? undefined : lane.marker.colour}
      aria-label={words}
      className={styles.lane}
    >
      <span className={styles.id} aria-hidden="true">
        <span className={styles.rank}>{String(lane.rank).padStart(2, "0")}</span>
        <span className={styles.desk}>{desk(labels, lane.desk)}</span>
      </span>
      <span className={styles.main} aria-hidden="true">
        <span className={styles.line}>
          {compact ? null : (
            <span data-name className={styles.name}>
              {lane.name}
            </span>
          )}
          {lane.you ? <span className={docket.tag}>{labels.you}</span> : null}
          {status ? (
            <span data-status-label={lane.status} className={styles.status}>
              {status}
            </span>
          ) : null}
        </span>
        <span className={styles.track}>
          <span data-rider className={styles.rider} style={at(lane.progress)}>
            <Marker shape={lane.marker.shape} />
          </span>
        </span>
      </span>
    </li>
  );
}

export type RaceCardProps = {
  view: RaceCardView;
  labels: RaceCardLabels;
  /** Tablets and small laptops: names hidden, markers, desk numbers and the field line kept. */
  compact?: boolean;
};

/**
 * The race card (#560, design bible 7.4a, spec 6.2): a 7.4 docket answering "where am I in the race".
 * The full-field line carries one tick per player (yours agit-red, rivals ribbon-violet) and ends in a
 * checkered finish; the lanes below show the selected players by rank, each with its marker shape riding
 * a track by progress, its paperwork desk number and its status label. Renders the view it is given:
 * selection is #564, rival inks #565 (ADR 0007, 0013).
 */
export function RaceCard({ view, labels, compact = false }: RaceCardProps) {
  const you = view.field.find((t) => t.you);
  return (
    <section
      aria-label={labels.title}
      data-race-card
      data-compact={compact || undefined}
      className={cn(docket.docket, styles.card)}
    >
      <div className={docket.head}>
        <span className={docket.tag}>{labels.title}</span>
        <span className={docket.mono}>{fill(labels.typists, { n: view.field.length })}</span>
      </div>
      <div
        role="img"
        aria-label={fill(labels.field, { n: view.field.length, you: percent(you?.progress ?? 0) })}
        className={styles.field}
      >
        <span className={styles.fieldTrack}>
          {view.field.map((t) => (
            <span
              key={t.desk}
              data-tick
              data-desk={t.desk}
              data-you={t.you || undefined}
              className={styles.tick}
              style={at(t.progress)}
            />
          ))}
        </span>
        <span data-finish className={styles.finish} />
      </div>
      <ol aria-label={labels.lanes} className={styles.lanes}>
        {view.lanes.map((lane) => (
          <LaneRow key={lane.desk} lane={lane} labels={labels} compact={compact} />
        ))}
      </ol>
    </section>
  );
}
