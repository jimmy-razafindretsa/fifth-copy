"use client";

import { useEffect, useId, useRef, useState } from "react";
import { fill } from "@/i18n/format";
import type { UpdatePreferences } from "../../actions/update-preferences";
import { DAILY_GOAL_MAX, DAILY_GOAL_MIN, DAILY_GOAL_STEP } from "../../schema";
import { SaveError, SaveState, type StatusLabels } from "./status-line";
import { usePreferenceSave, type SaveStatus } from "./use-preference-save";
import styles from "./settings.module.css";

export type DailyGoalLabels = {
  title: string;
  /** `{n} MIN / DAY`: the shown value. */
  value: string;
  /** `{n} minutes a day`: the range's spoken value. */
  valueText: string;
  hint: string;
};

/**
 * The daily goal (#968, bible 14.3 "Settings", reference `Profil.dc.html` `OBJECTIF QUOTIDIEN`): the
 * section name and its save state, the value in red Plex Mono at the right, a native range 5 to 60 in
 * steps of 5 (the output curve's `LISSAGE` range of #933: 44px, red accent) and the hint. Dragging shows
 * the value at once; releasing the thumb (or each arrow-key step) files it, on the range's native
 * `change`, so a drag files once. A refusal puts the filed value back with the 7.4 error line.
 */
export function DailyGoal(props: {
  value: number;
  labels: DailyGoalLabels;
  status: StatusLabels;
  action: UpdatePreferences;
  initialStatus?: SaveStatus;
}) {
  const { labels } = props;
  const id = useId();
  const { value, status, save, hydrated } = usePreferenceSave(
    props.value,
    props.action,
    props.initialStatus,
  );
  // the value under the thumb while it moves; null once filed (or put back)
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  const input = useRef<HTMLInputElement>(null);
  const commit = useRef<(next: number) => void>(() => {});
  useEffect(() => {
    commit.current = (next) => {
      setDraft(null);
      save(next, { dailyGoalMin: next });
    };
  });
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const onChange = () => commit.current(Number(el.value));
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);

  const titleId = `${id}-title`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <section className={styles.section} aria-labelledby={titleId} data-setting="dailyGoalMin">
      <div className={styles.goalHead}>
        <div className={styles.goalName}>
          <h2 id={titleId} className={styles.sectionTitle}>
            {labels.title}
          </h2>
          <SaveState status={status} labels={props.status} />
        </div>
        <span className={styles.goalValue} aria-hidden="true" data-goal-value="">
          {fill(labels.value, { n: shown })}
        </span>
      </div>
      <input
        ref={input}
        type="range"
        min={DAILY_GOAL_MIN}
        max={DAILY_GOAL_MAX}
        step={DAILY_GOAL_STEP}
        value={shown}
        onChange={(e) => setDraft(Number(e.target.value))}
        aria-labelledby={titleId}
        aria-valuetext={fill(labels.valueText, { n: shown })}
        aria-describedby={[hintId, status === "error" ? errorId : null].filter(Boolean).join(" ")}
        aria-busy={status === "pending" || undefined}
        data-hydrated={hydrated || undefined}
        className={styles.goalRange}
      />
      <p id={hintId} className={styles.hint}>
        {labels.hint}
      </p>
      {status === "error" && <SaveError id={errorId} labels={props.status} />}
    </section>
  );
}
