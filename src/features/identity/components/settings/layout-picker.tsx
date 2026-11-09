"use client";

import { useId } from "react";
import type { UpdatePreferences } from "../../actions/update-preferences";
import { keyboardLayoutIds, layouts, type KeyboardLayoutId } from "../../keyboard/layouts";
import { SaveError, SaveState, type StatusLabels } from "./status-line";
import { usePreferenceSave, type SaveStatus } from "./use-preference-save";
import styles from "./settings.module.css";

/** An accent key: a letter outside plain ASCII (é, è, à, ç, ù), marked in ink on the preview. */
const isAccent = (key: string) => /[^\x00-\x7f]/.test(key) && /\p{L}/u.test(key);

/** The three-row mini keyboard of one layout (`layouts.ts`), decorative: the card's name is its label. */
export function KeyboardPreview({ layout }: { layout: KeyboardLayoutId }) {
  return (
    <span className={styles.keyboard} aria-hidden="true" data-preview={layout}>
      {layouts[layout].map((row, r) => (
        <span key={r} className={styles.row}>
          {row.map((key, k) => (
            <span
              key={k}
              className={styles.key}
              data-key={key}
              data-accent={isAccent(key) || undefined}
            >
              {key}
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

/**
 * Keyboard layout (#66 C10, R179): a radio group of the four layouts, each a card with its name and a
 * three-row preview; choosing one files it. No layout chosen yet = no radio checked.
 */
export function LayoutPicker(props: {
  value: KeyboardLayoutId | null;
  title: string;
  hint: string;
  names: Record<KeyboardLayoutId, string>;
  status: StatusLabels;
  action: UpdatePreferences;
  initialStatus?: SaveStatus;
}) {
  const id = useId();
  const { value, status, save, hydrated } = usePreferenceSave(
    props.value,
    props.action,
    props.initialStatus,
  );
  const titleId = `${id}-title`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <section className={styles.section} aria-labelledby={titleId} data-setting="layout">
      <div className={styles.sectionHead}>
        <h2 id={titleId} className={styles.sectionTitle}>
          {props.title}
        </h2>
        <SaveState status={status} labels={props.status} />
      </div>
      <p id={hintId} className={styles.hint}>
        {props.hint}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={titleId}
        aria-describedby={status === "error" ? `${hintId} ${errorId}` : hintId}
        aria-busy={status === "pending" || undefined}
        data-hydrated={hydrated || undefined}
        className={`${styles.group} ${styles.layouts}`}
      >
        {keyboardLayoutIds.map((layout) => (
          <label key={layout} className={styles.option} data-layout={layout}>
            <input
              type="radio"
              className={styles.radio}
              name={`${id}-layout`}
              value={layout}
              checked={value === layout}
              onChange={() => save(layout, { layout })}
            />
            <span className={styles.optionName}>{props.names[layout]}</span>
            <KeyboardPreview layout={layout} />
          </label>
        ))}
      </div>
      {status === "error" && <SaveError id={errorId} labels={props.status} />}
    </section>
  );
}
