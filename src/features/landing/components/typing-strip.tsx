"use client";

import { useId, useState } from "react";
import { fill } from "@/i18n/format";
import { charStates, verdict } from "../typing-strip-model";
import styles from "./hero.module.css";

export type TapeLabels = {
  hint: string;
  again: string;
  sentence: string;
  inputLabel: string;
  accepted: string;
  returned: string;
};

type Run = { typed: string; startedAt: number | null; endedAt: number | null };
const fresh: Run = { typed: "", startedAt: null, endedAt: null };

/**
 * "Try the keys" (bible 7.7): a transparent input over the tape captures typing; done = ink, wrong = red,
 * next = blinking red cell, remaining = violet. On completion the verdict stamp slams in. Remount with a
 * new `labels.sentence` to switch language.
 */
export function TypingStrip({
  labels,
  now = Date.now,
}: {
  labels: TapeLabels;
  now?: () => number;
}) {
  const id = useId();
  const [run, setRun] = useState<Run>(fresh);
  const target = labels.sentence;
  const states = charStates(target, run.typed);
  const lastTyped = Array.from(run.typed).length - 1;
  const result =
    run.startedAt !== null && run.endedAt !== null
      ? verdict(target, run.typed, run.endedAt - run.startedAt)
      : null;
  const stamp =
    result?.kind === "accepted"
      ? fill(labels.accepted, { wpm: result.wpm })
      : result?.kind === "returned"
        ? fill(labels.returned, { n: result.errors })
        : "";

  const onType = (value: string) => {
    const typed = Array.from(value).slice(0, Array.from(target).length).join("");
    setRun((prev) => {
      const startedAt = prev.startedAt ?? now();
      const done = Array.from(typed).length >= Array.from(target).length;
      return { typed, startedAt, endedAt: done ? now() : null };
    });
  };

  return (
    <div className={styles.tape}>
      <div className={styles.tapeHead}>
        <span id={`${id}-hint`}>{labels.hint}</span>
        <button type="button" className={styles.again} onClick={() => setRun(fresh)}>
          {labels.again}
        </button>
      </div>
      <label className={styles.strip} data-tape>
        <span className={styles.chars} aria-hidden="true">
          {Array.from(target).map((ch, i) => (
            <span
              key={`${i}-${ch}`}
              className={styles.char}
              data-state={states[i]}
              data-last={i === lastTyped ? "true" : undefined}
            >
              {ch}
            </span>
          ))}
        </span>
        <input
          className={styles.tapeInput}
          value={run.typed}
          onChange={(event) => onType(event.target.value)}
          maxLength={target.length}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label={labels.inputLabel}
          aria-describedby={`${id}-hint`}
        />
        <output className={styles.tapeStamp} aria-live="polite" htmlFor={undefined}>
          {stamp}
        </output>
      </label>
    </div>
  );
}
