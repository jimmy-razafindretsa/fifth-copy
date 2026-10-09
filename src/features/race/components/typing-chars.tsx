import type { ReactNode } from "react";
import type { TypedChar } from "../view/typed-view";
import styles from "./typing.module.css";

/**
 * The one char renderer of the typing surface (#558, bible 7.7): a `<span data-state>` per char, in order,
 * and nothing else as text. The span at `last` carries `data-last` (the pop); its React key includes
 * `stamp` (the view's `lastTypedAt`), so a retype at the same index remounts it and pops again.
 * `words` wraps each run of non-space chars in a no-wrap box, so a multi-line sheet breaks between words.
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
  const span = (c: TypedChar, i: number) => (
    <span
      key={i === last ? `${i}-${stamp ?? "none"}` : i}
      className={styles.char}
      data-state={c.state}
      data-last={i === last ? "true" : undefined}
    >
      {c.ch}
    </span>
  );

  if (!words) return chars.map(span);

  // runs of non-space chars become no-wrap boxes; spaces stay loose spans between them (break points)
  const out: ReactNode[] = [];
  let run: ReactNode[] = [];
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
    if (/\s/.test(c.ch)) {
      flush(i);
      out.push(span(c, i));
    } else {
      run.push(span(c, i));
    }
  });
  flush(chars.length);
  return out;
}
