import { Stamp } from "@/components/ui";
import { fill } from "@/i18n/format";
import styles from "./stamp-row.module.css";

/**
 * The seat view's stamps: you passed someone, someone passed you (#232); your finish (#240, bible 7.7):
 * `accepted` with zero errors, `returned` otherwise.
 */
export type StampRowKind = "overtake" | "passed" | "accepted" | "returned";

/**
 * The `race.stamps` copy: per overtake kind the in-world Russian word and this language's line (bible 2:
 * an explicitly dual stamp, `ОБГОН! · OVERTAKE +1` / `ОБГОН! · DÉPASSEMENT +1`); the finish lines of
 * bible 2 and 7.7 (`ACCEPTED · {wpm} WPM`, `RETURNED · {n} ERRORS`, singular for one error).
 */
export type StampRowLabels = Record<"overtake" | "passed", { ru: string; text: string }> & {
  accepted: string;
  returned: string;
  returnedOne: string;
};

type StampOf = { kind: StampRowKind; errors: number };

/** The finish stamp's line (one language, no Russian). */
function finishText({ kind, errors }: StampOf, wpm: number, labels: StampRowLabels): string {
  if (kind === "accepted") return fill(labels.accepted, { wpm: Math.round(wpm) });
  return errors === 1 ? labels.returnedOne : fill(labels.returned, { n: errors });
}

/** The stamp's line in words, as it reads (the seat announcer says it; the stamp itself is hidden). */
export function stampText(stamp: StampOf, wpm: number, labels: StampRowLabels): string {
  if (stamp.kind === "overtake" || stamp.kind === "passed") {
    const { ru, text } = labels[stamp.kind];
    return `${ru} · ${text}`;
  }
  return finishText(stamp, wpm, labels);
}

/** Red for you (`OVERTAKE +1`, `ACCEPTED`), ink for neutral paperwork (`PASSED −1`, `RETURNED`; 7.3). */
const TONE = { overtake: "red", passed: "ink", accepted: "red", returned: "ink" } as const;

/**
 * The stamp over the scene area (#232, #240, bible 7.3, 7.7, 8, 14.3): one `Stamp` at `md`, at an angle
 * seeded by the stamp's id; a new id remounts it, so each one slams in (simply appears under reduced
 * motion). Like the countdown it fills the free space above the typing surface, centred, and clips the
 * slam, so it never paints over the strip or the sheet. Presentational and hidden from assistive tech:
 * the seat view's announcer says it. `wpm` is your finish figure (the finish stamps read it). `stamp`
 * null renders nothing.
 */
export function StampRow({
  stamp,
  wpm = 0,
  labels,
}: {
  stamp: ({ id: number } & StampOf) | null;
  wpm?: number;
  labels: StampRowLabels;
}) {
  if (!stamp) return null;
  const line =
    stamp.kind === "overtake" || stamp.kind === "passed" ? (
      <>
        <span lang="ru">{labels[stamp.kind].ru}</span> · {labels[stamp.kind].text}
      </>
    ) : (
      finishText(stamp, wpm, labels)
    );
  return (
    <div data-stamps={stamp.kind} aria-hidden="true" className={styles.row}>
      <Stamp
        key={stamp.id}
        size="md"
        tone={TONE[stamp.kind]}
        rotation="auto"
        seed={stamp.id}
        role={null}
        lines={[line]}
      />
    </div>
  );
}
