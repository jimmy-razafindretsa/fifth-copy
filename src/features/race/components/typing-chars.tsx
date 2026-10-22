import type { ReactNode } from "react";
import type { TypedChar } from "../view/typed-view";
import styles from "./typing.module.css";

/** Whitespace a line may break after; the no-break spaces of French typography (« », :) hold. */
const BREAKING_SPACE = /[^\S\u00A0\u202F\u2007]/;

/**
 * The one char renderer of the typing surface (#558, bible 7.7): a `<span data-state>` per char, in order,
 * and nothing else as text. The span at `last` carries `data-last` (the pop) while `stamp` (the view's
 * `lastTypedAt`) is known; its React key includes `stamp`, so a retype at the same index remounts it and
 * pops again, and a key that typed nothing (`stamp` kept or `null`, #220) pops nothing.
 * `words` wraps each word and its trailing spaces in a no-wrap box, so a multi-line sheet breaks between
 * words.
 */
export function TypingChars({
  chars,
  last,
  stamp,
  words = false,
}: {
  chars: readonly TypedChar[];
  last: number;
  stamp: number | null;
  words?: boolean;
}) {
  const pop = stamp === null ? -1 : last;
  const span = (c: TypedChar, i: number) => (
    <span
      key={i === pop ? `${i}-${stamp}` : i}
      className={styles.char}
      data-state={c.state}
      data-last={i === pop ? "true" : undefined}
    >
      {c.ch}
    </span>
  );

  if (!words) return chars.map(span);

  // a word and the spaces after it form one no-wrap box: lines break only after a space, so no line
  // starts with one, and a caret on a space stays visible at the end of its word
  const out: ReactNode[] = [];
  let run: ReactNode[] = [];
  let afterSpace = false;
  const flush = (at: number) => {
    if (run.length === 0) return;
    out.push(
      <span key={`w${at}`} className={styles.word}>
        {run}
      </span>,
    );
    run = [];
  };
  chars.forEach((c, i) => {
    const space = BREAKING_SPACE.test(c.ch);
    if (!space && afterSpace) flush(i);
    run.push(span(c, i));
    afterSpace = space;
  });
  flush(chars.length);
  return out;
}
