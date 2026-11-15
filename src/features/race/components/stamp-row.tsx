import { Stamp } from "@/components/ui";
import { fill } from "@/i18n/format";
import styles from "./stamp-row.module.css";

/**
 * The seat view's stamps: you passed someone, someone passed you (#232); your finish (#240, bible 7.7):
 * `accepted` with zero errors, `returned` otherwise; the room's new host (#868, bible 14.3).
 */
export type StampRowKind = "overtake" | "passed" | "accepted" | "returned" | "new-host";

/**
 * The `race.stamps` copy: per overtake kind the in-world Russian word and this language's line (bible 2:
 * an explicitly dual stamp, `ОБГОН! · OVERTAKE +1` / `ОБГОН! · DÉPASSEMENT +1`); the finish lines of
 * bible 2 and 7.7 (`ACCEPTED · {wpm} WPM`, `RETURNED · {n} ERRORS`, singular for one error).
 */
export type StampRowLabels = Record<"overtake" | "passed", { ru: string; text: string }> & {
  /** #951: the plain overtake line, `{name} overtook you` / `You overtook {name}`. */
  overtakeLine: { overtake: string; passed: string; someone: string };
  accepted: string;
  returned: string;
  returnedOne: string;
  /** The lobby's strings (#137): `NEW HOST: {name}` and its sentence `{name} is the new host.` */
  newHost: { stamp: string; announce: string };
};

/** `name`: the new host's, as the roster held it (`new-host` only). */
type StampOf = { kind: StampRowKind; errors: number; name?: string };

/** The finish stamp's line, or the NEW HOST line (one language, no Russian). */
function finishText(
  { kind, errors, name = "" }: StampOf,
  wpm: number,
  labels: StampRowLabels,
): string {
  if (kind === "new-host") return fill(labels.newHost.stamp, { name: name.toLocaleUpperCase() });
  if (kind === "accepted") return fill(labels.accepted, { wpm: Math.round(wpm) });
  return errors === 1 ? labels.returnedOne : fill(labels.returned, { n: errors });
}

/** The stamp's line in words, as it reads (the seat announcer says it; the stamp itself is hidden). */
export function stampText(
  stamp: StampOf,
  wpm: number,
  labels: StampRowLabels,
  otherName: string | null = null,
): string {
  if (stamp.kind === "overtake" || stamp.kind === "passed") {
    return fill(labels.overtakeLine[stamp.kind], {
      name: otherName ?? labels.overtakeLine.someone,
    });
  }
  return finishText(stamp, wpm, labels);
}

/**
 * Red for you (`OVERTAKE +1`, `ACCEPTED`), ink for neutral paperwork (`PASSED −1`, `RETURNED`, and
 * `NEW HOST: <NAME>` on the seat, which is news about the room, not about your copy; 7.3, 14.3).
 */
const TONE = {
  overtake: "red",
  passed: "ink",
  accepted: "red",
  returned: "ink",
  "new-host": "ink",
} as const;

/**
 * The stamp over the scene area (#232, #240, bible 7.3, 7.7, 8, 14.3): one `Stamp` at `md`, at an angle
 * seeded by the stamp's id; a new id remounts it, so each one slams in (simply appears under reduced
 * motion). Like the countdown it fills the free space above the typing surface, centred, and clips the
 * slam, so it never paints over the strip or the sheet. Presentational and hidden from assistive tech:
 * the seat view's announcer says it. `wpm` is your finish figure (the finish stamps read it). The NEW
 * HOST notice (#868) is one more kind: the ink stamp `NEW HOST: <NAME>`, held 3 s by the queue. `stamp`
 * null renders nothing.
 */
export function StampRow({
  stamp,
  wpm = 0,
  labels,
  otherName = null,
}: {
  stamp: ({ id: number } & StampOf) | null;
  wpm?: number;
  labels: StampRowLabels;
  /** The other typist of an overtake (#951), from the roster; `null` reads "someone". */
  otherName?: string | null;
}) {
  if (!stamp) return null;
  // #951 (owner): an overtake is one quiet line, not the big dual stamp
  if (stamp.kind === "overtake" || stamp.kind === "passed") {
    return (
      <div data-stamps={stamp.kind} aria-hidden="true" className={styles.row}>
        <p key={stamp.id} className={styles.line} data-stamp-tone={TONE[stamp.kind]}>
          {stampText(stamp, wpm, labels, otherName)}
        </p>
      </div>
    );
  }
  const line = finishText(stamp, wpm, labels);
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
