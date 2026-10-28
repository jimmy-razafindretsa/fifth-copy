import { Stamp } from "@/components/ui";
import styles from "./stamp-row.module.css";

/** The seat view's overtake stamps (#232): you passed someone, someone passed you. */
export type StampRowKind = "overtake" | "passed";

/**
 * The `race.stamps` copy: per kind the in-world Russian word and this language's line (bible 2: an
 * explicitly dual stamp, `ОБГОН! · OVERTAKE +1` / `ОБГОН! · DÉPASSEMENT +1`).
 */
export type StampRowLabels = Record<StampRowKind, { ru: string; text: string }>;

/**
 * The overtake stamp over the scene area (#232, bible 7.3, 8, 14.3): one `Stamp` at `md`, red for
 * `OVERTAKE +1` (you), ink for `PASSED −1` (neutral paperwork), at an angle seeded by the stamp's id;
 * a new id remounts it, so each one slams in (simply appears under reduced motion). Like the countdown
 * it fills the free space above the typing surface, centred, and clips the slam, so it never paints
 * over the strip or the sheet. Presentational and hidden from assistive tech: the seat view's
 * announcer says it. `stamp` null renders nothing.
 */
export function StampRow({
  stamp,
  labels,
}: {
  stamp: { id: number; kind: StampRowKind } | null;
  labels: StampRowLabels;
}) {
  if (!stamp) return null;
  const { ru, text } = labels[stamp.kind];
  return (
    <div data-stamps={stamp.kind} aria-hidden="true" className={styles.row}>
      <Stamp
        key={stamp.id}
        size="md"
        tone={stamp.kind === "overtake" ? "red" : "ink"}
        rotation="auto"
        seed={stamp.id}
        role={null}
        lines={[
          <>
            <span lang="ru">{ru}</span> · {text}
          </>,
        ]}
      />
    </div>
  );
}
