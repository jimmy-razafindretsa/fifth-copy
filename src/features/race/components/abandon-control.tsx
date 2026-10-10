"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui";
import type { AbandonLabels } from "../view/hud-labels";
import styles from "./abandon-control.module.css";

/** An unanswered confirm cancels itself after 5 s (spec 4.4: a quick confirm, never a trap). */
export const ABANDON_CONFIRM_MS = 5000;

/**
 * Arms the confirm's two ways out: `Escape` on `target` (the document) or `ABANDON_CONFIRM_MS` without an
 * answer calls `onCancel`, once. Returns the disposer (leaving `confirm` disarms both). Pure enough to be
 * tested with a bare `EventTarget` and fake timers.
 */
export function armAbandonCancel(target: EventTarget, onCancel: () => void): () => void {
  let armed = true;
  const cancel = () => {
    if (!armed) return;
    dispose();
    onCancel();
  };
  const onKey = (e: Event) => {
    if ((e as KeyboardEvent).key === "Escape") cancel();
  };
  const timer = setTimeout(cancel, ABANDON_CONFIRM_MS);
  function dispose() {
    armed = false;
    clearTimeout(timer);
    target.removeEventListener("keydown", onKey);
  }
  target.addEventListener("keydown", onKey);
  return dispose;
}

export type AbandonState = "idle" | "confirm" | "disabled";

export type AbandonControlProps = {
  /** `disabled`: visible but inert (before GO, after finishing; #233). */
  state: AbandonState;
  /** ABANDON pressed while idle: the caller moves to `confirm`. */
  onAbandon: () => void;
  /** The ink confirm pressed: the caller sends the abandon intent (#233). */
  onConfirm: () => void;
  /** ABANDON pressed again, `Escape`, or 5 s without an answer: the caller moves back to `idle`. */
  onCancel: () => void;
  labels: AbandonLabels;
};

/**
 * The always-visible Abandon control (#560, design bible 7.1, spec 4.4): the secondary button `ABANDON`;
 * in `confirm` the ink button `CONFIRM · REASSIGN ME` appears beside it (ABANDON is its disclosure), and
 * `Escape`, a second ABANDON or 5 s cancel. Hit targets are at least 44 px (bible 18). The state lives
 * with the caller; this leaf only owns the cancel timer and key.
 */
export function AbandonControl({
  state,
  onAbandon,
  onConfirm,
  onCancel,
  labels,
}: AbandonControlProps) {
  const confirmId = useId();
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    cancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (state !== "confirm") return;
    return armAbandonCancel(document, () => cancelRef.current());
  }, [state]);

  const confirming = state === "confirm";
  return (
    <div data-abandon={state} className={styles.control}>
      <Button
        variant="secondary"
        className="min-h-11 min-w-11"
        disabled={state === "disabled"}
        aria-expanded={confirming}
        aria-controls={confirming ? confirmId : undefined}
        onClick={confirming ? onCancel : onAbandon}
      >
        {labels.abandon}
      </Button>
      {confirming ? (
        <button id={confirmId} type="button" className={styles.ink} onClick={onConfirm}>
          {labels.confirm}
        </button>
      ) : null}
    </div>
  );
}
