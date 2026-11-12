"use client";

import type { MouseEvent } from "react";
import type { SoundLabels } from "../view/hud-labels";
import styles from "./sound-toggle.module.css";

export type SoundToggleProps = {
  /** Sound is on (unmuted). */
  on: boolean;
  /** A choice is on its way to the viewer's file. */
  saving: boolean;
  /** The last choice was refused: its value is back and the inline error line shows. */
  refused: boolean;
  onChoose: (on: boolean) => void;
  labels: SoundLabels;
};

const ERROR_ID = "sound-toggle-error";

/**
 * The seat view's sound toggle (#243, bible 7.1 segmented toggle, 7.2 pending, 7.4 inline error line):
 * `SOUND` + `OFF | ON` (`SON` + `NON | OUI`). Presentational: the live leaf (`seat/seat-sound.tsx`) holds
 * the choice, files it and loads the audio. While a choice is on its way the segments are unavailable
 * (`aria-disabled`, the group `aria-busy`, full strength, no spinner) and a polite `FILING…` shows; a
 * refusal shows `RETURNED ·` + one sentence. A pointer press keeps the focus in the race input (the
 * Abandon and tray path, #233, #236).
 */
export function SoundToggle({ on, saving, refused, onChoose, labels }: SoundToggleProps) {
  const keepFocus = (e: MouseEvent) => e.preventDefault();
  return (
    <div className={styles.sound}>
      <div
        role="group"
        aria-label={labels.label}
        aria-busy={saving || undefined}
        aria-describedby={refused ? ERROR_ID : undefined}
        data-sound={on ? "on" : "off"}
        className={styles.row}
      >
        <span aria-hidden="true" className={styles.label}>
          {labels.label}
        </span>
        <span className={styles.segmented}>
          {([false, true] as const).map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={on === value}
              aria-disabled={saving || undefined}
              onMouseDown={keepFocus}
              onClick={() => {
                if (!saving && value !== on) onChoose(value);
              }}
              className={styles.segment}
            >
              {value ? labels.on : labels.off}
            </button>
          ))}
        </span>
        <span role="status" className={styles.pending}>
          {saving ? labels.pending : ""}
        </span>
      </div>
      {refused ? (
        <p id={ERROR_ID} role="alert" className={styles.error}>
          <span className={styles.errorPrefix}>{labels.errorPrefix}</span> {labels.error}
        </p>
      ) : null}
    </div>
  );
}
