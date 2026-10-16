import { Stamp } from "@/components/ui";
import { cn } from "@/lib/cn";
import styles from "./countdown.module.css";

/** What the seat shows before and at GO (#214): the digits, then the Major's stamp. */
export type CountdownStep = 3 | 2 | 1 | "go";

/** The `race.countdown` copy: the Major's word (in-world Russian, bible 2) and the GO word. */
export type CountdownLabels = { major: string; go: string };

/** How long the GO stamp stays after GO. */
export const GO_STAMP_MS = 1_200;

/**
 * The step for the time left to GO on the server clock: `3` above 2 s, `2`, `1`, then the GO stamp from
 * GO until `GO_STAMP_MS` after it, then nothing. More than 3 s left (a skewed clock) still reads `3`.
 */
export function countdownStep(msToGo: number): CountdownStep | null {
  if (msToGo > 0) return Math.min(3, Math.ceil(msToGo / 1000)) as 3 | 2 | 1;
  if (msToGo > -GO_STAMP_MS) return "go";
  return null;
}

/** Milliseconds until `countdownStep` changes, or `null` once the stamp is gone. */
export function nextStepIn(msToGo: number): number | null {
  if (msToGo > 0) return ((msToGo - 1) % 1000) + 1;
  if (msToGo > -GO_STAMP_MS) return msToGo + GO_STAMP_MS;
  return null;
}

/**
 * The countdown overlay (#214, bible 7.3, 4, 8, 14.3): `3`, `2`, `1` in the display-lg role, each
 * slamming in (`fcSlam` on `--motion-duration-slam`, upright), then the red `Stamp` `НАЧАЛИ · GO` at a
 * fixed -6 degrees. It fills the free space above the typing surface, centred, and clips the slam so it
 * never paints over the strip or the sheet. Under reduced motion both simply appear. Presentational:
 * the seat view computes the step on the corrected clock and announces it (the overlay is hidden from
 * assistive tech, the announcer carries it).
 */
export function Countdown({ step, labels }: { step: CountdownStep; labels: CountdownLabels }) {
  return (
    <div data-countdown={step} aria-hidden="true" className={styles.countdown}>
      {step === "go" ? (
        <Stamp
          key="go"
          size="lg"
          tone="red"
          rotation={-6}
          role={null}
          lines={[
            <>
              <span lang="ru">{labels.major}</span> · {labels.go}
            </>,
          ]}
        />
      ) : (
        // a new key per digit remounts it, so each one slams in
        <span key={step} data-digit={step} className={cn("type-display-lg", styles.digit)}>
          {step}
        </span>
      )}
    </div>
  );
}
