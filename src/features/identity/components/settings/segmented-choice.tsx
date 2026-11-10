"use client";

import { useId, type ReactNode } from "react";
import type { UpdatePreferences } from "../../actions/update-preferences";
import type { PreferencesPatch } from "../../schema";
import { SaveError, SaveState, type StatusLabels } from "./status-line";
import { usePreferenceSave, type SaveStatus } from "./use-preference-save";
import styles from "./settings.module.css";

export type ChoiceOption<T extends string> = { value: T; label: string; lang?: string };

export type SegmentedSectionProps<T extends string> = {
  /** The preference key this section files. */
  name: "theme" | "locale" | "sound" | "machineSkin";
  title: string;
  hint?: string;
  options: readonly ChoiceOption<T>[];
  value: T;
  toPatch: (value: T) => PreferencesPatch;
  apply?: (value: T) => void;
  action: UpdatePreferences;
  status: StatusLabels;
  /** `/design` specimens start in a given save state (#66 C7). */
  initialStatus?: SaveStatus;
  /** A decorative picture of the shown value under the control (the machine specimen, #638). */
  specimen?: (value: T) => ReactNode;
};

/**
 * One settings section whose control is the 7.1 segmented toggle (#66): native radios in a named group
 * (arrow keys move and choose), the checked segment ink with paper text. Choosing files it at once.
 */
export function SegmentedSection<T extends string>(props: SegmentedSectionProps<T>) {
  const { name, title, hint, options, toPatch, apply, action, status: labels } = props;
  const id = useId();
  const { value, status, save, hydrated } = usePreferenceSave(
    props.value,
    action,
    props.initialStatus,
    apply,
  );
  const titleId = `${id}-title`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, status === "error" ? errorId : null]
    .filter(Boolean)
    .join(" ");
  return (
    <section className={styles.section} aria-labelledby={titleId} data-setting={name}>
      <div className={styles.sectionHead}>
        <h2 id={titleId} className={styles.sectionTitle}>
          {title}
        </h2>
        <SaveState status={status} labels={labels} />
      </div>
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      <div
        role="radiogroup"
        aria-labelledby={titleId}
        aria-describedby={describedBy || undefined}
        aria-busy={status === "pending" || undefined}
        data-hydrated={hydrated || undefined}
        className={`${styles.group} ${styles.segmented}`}
      >
        {options.map((option) => (
          <label key={option.value} className={styles.segment} lang={option.lang}>
            <input
              type="radio"
              className={styles.radio}
              name={`${id}-${name}`}
              value={option.value}
              checked={value === option.value}
              onChange={() => save(option.value, toPatch(option.value))}
            />
            {option.label}
          </label>
        ))}
      </div>
      {status === "error" && <SaveError id={errorId} labels={labels} />}
      {props.specimen?.(value)}
    </section>
  );
}
