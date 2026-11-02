"use client";

import { useEffect, useState } from "react";

/** `open` while an on-screen keyboard covers the page, `closed` otherwise (a hardware keyboard, no keyboard). */
export type OskState = "open" | "closed";

/** The race input the detection follows (`RaceInput`). */
export const RACE_INPUT = "[data-race-input]";
/** An on-screen keyboard leaves less than this share of the page's height visible (#251 C1). */
export const OSK_RATIO = 0.7;
/** It opens within this long of focusing the race input (#251 C1). */
export const OSK_WINDOW_MS = 300;

/** The slice of `window` the detection reads, injectable for tests. */
export type OskEnv = {
  document: Pick<Document, "addEventListener" | "removeEventListener">;
  visualViewport: Pick<
    VisualViewport,
    "height" | "addEventListener" | "removeEventListener"
  > | null;
  innerHeight: () => number;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

/**
 * Watches for an on-screen keyboard (#251 C1, bible 14.3 tablets): when the visual viewport shrinks below
 * 70 % of the page's height within 300 ms of focusing the race input, a keyboard opened over the page
 * (`open`); when it grows back to 70 % or more, it closed (`closed`). A hardware keyboard never shrinks the
 * viewport, so the state stays `closed`. The page's height is `innerHeight` read at the focus: browsers
 * that resize the layout for the keyboard (Android's default) shrink `innerHeight` with it, so a reading
 * taken during the resize would always match. Returns the cleanup.
 */
export function watchOnScreenKeyboard(
  env: OskEnv,
  onChange: (state: OskState) => void,
): () => void {
  const vv = env.visualViewport;
  if (!vv) return () => {};
  let state: OskState = "closed";
  let focusedAt = -Infinity;
  let base = env.innerHeight();
  let timer: unknown = null;

  const set = (next: OskState) => {
    if (next === state) return;
    state = next;
    onChange(next);
  };
  const covered = () => vv.height < OSK_RATIO * base;
  const check = () => {
    if (state === "closed") {
      if (env.now() - focusedAt <= OSK_WINDOW_MS && covered()) set("open");
    } else if (!covered()) {
      set("closed");
    }
  };
  const onFocus = (e: Event) => {
    const target = e.target as Element | null;
    if (!target?.matches?.(RACE_INPUT)) return;
    focusedAt = env.now();
    if (state === "closed") base = env.innerHeight();
    check();
    if (timer !== null) env.clearTimeout(timer);
    // a keyboard that fired its resize before the focus event still counts
    timer = env.setTimeout(() => {
      timer = null;
      check();
    }, OSK_WINDOW_MS);
  };

  env.document.addEventListener("focusin", onFocus);
  vv.addEventListener("resize", check);
  return () => {
    env.document.removeEventListener("focusin", onFocus);
    vv.removeEventListener("resize", check);
    if (timer !== null) env.clearTimeout(timer);
  };
}

/** The browser's `OskEnv`. */
const browserEnv = (): OskEnv => ({
  document,
  visualViewport: window.visualViewport,
  innerHeight: () => window.innerHeight,
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id as number),
});

/** The seat view's on-screen keyboard state (#251 C1); `closed` on the server and before hydration. */
export function useOnScreenKeyboard(): OskState {
  const [state, setState] = useState<OskState>("closed");
  useEffect(() => watchOnScreenKeyboard(browserEnv(), setState), []);
  return state;
}
