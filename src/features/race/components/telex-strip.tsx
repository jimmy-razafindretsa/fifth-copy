"use client";

import { useLayoutEffect, useRef } from "react";
import type { TypedView } from "../view/typed-view";
import styles from "./telex-strip.module.css";
import { TypingChars } from "./typing-chars";

export type TelexLabels = {
  /** The accessible name of the strip (the glyphs themselves are hidden from assistive tech). */
  strip: string;
};

/**
 * The reading band of the strip, as fractions of its visible width: while the next char sits between
 * `from` and `to` the tape holds still; once it leaves, the tape moves so the char lands at `anchor`
 * (more of the text ahead stays visible, and the tape moves in steps rather than on every key).
 */
export const TELEX_BAND = { from: 0.2, to: 0.7, anchor: 0.3 } as const;

/**
 * The strip's next `scrollLeft` for the char at `nextLeft` (px from the start of the tape, `nextWidth`
 * wide) in a viewport `viewportWidth` wide scrolled to `scrollLeft`. Pure, so it is unit-tested alone.
 */
export function telexScrollLeft(
  nextLeft: number,
  nextWidth: number,
  viewportWidth: number,
  scrollLeft: number,
): number {
  const from = scrollLeft + viewportWidth * TELEX_BAND.from;
  const to = scrollLeft + viewportWidth * TELEX_BAND.to;
  if (nextLeft >= from && nextLeft + nextWidth <= to) return scrollLeft;
  return Math.max(0, Math.round(nextLeft - viewportWidth * TELEX_BAND.anchor));
}

/** Scrolls `viewport` so char `index` of `tape` sits in the reading band (`behavior` undefined = CSS). */
function placeTape(
  viewport: HTMLElement | null,
  tape: HTMLElement | null,
  index: number,
  behavior?: ScrollBehavior,
) {
  const el = tape?.children[index];
  if (!viewport || !(el instanceof HTMLElement)) return;
  const left =
    el.getBoundingClientRect().left - viewport.getBoundingClientRect().left + viewport.scrollLeft;
  const target = telexScrollLeft(left, el.offsetWidth, viewport.clientWidth, viewport.scrollLeft);
  if (target !== viewport.scrollLeft) viewport.scrollTo({ left: target, behavior });
}

/**
 * The telex strip (#558, bible 7.7): the whole text on one line of tape, each char in its state, scrolled
 * so the next char stays in view. Cursor changes follow with the CSS `scroll-behavior` (smooth, `auto`
 * under reduced motion); the first placement and re-placements after a resize or a font swap are instant.
 */
export function TelexStrip({ view, labels }: { view: TypedView; labels: TelexLabels }) {
  const viewport = useRef<HTMLDivElement>(null);
  const tape = useRef<HTMLSpanElement>(null);
  // the char to keep in view: the next one, or the last one once the copy is finished
  const focus = Math.max(0, Math.min(view.cursor, view.chars.length - 1));
  const placed = useRef(focus);

  useLayoutEffect(() => {
    const vp = viewport.current;
    const chars = tape.current;
    if (!vp || !chars) return;
    placeTape(vp, chars, placed.current, "instant");
    // a resize, a new text or the brand face replacing its fallback moves every char: re-place at once
    const observer = new ResizeObserver(() => placeTape(vp, chars, placed.current, "instant"));
    observer.observe(vp);
    observer.observe(chars);
    vp.dataset.telexReady = "true";
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (placed.current === focus) return;
    placed.current = focus;
    placeTape(viewport.current, tape.current, focus);
  }, [focus]);

  return (
    <div role="group" aria-label={labels.strip} className={styles.strip} data-telex>
      <div ref={viewport} className={styles.viewport}>
        <span ref={tape} className={styles.tape} aria-hidden="true">
          <TypingChars chars={view.chars} last={view.cursor - 1} stamp={view.lastTypedAt} />
        </span>
      </div>
    </div>
  );
}
