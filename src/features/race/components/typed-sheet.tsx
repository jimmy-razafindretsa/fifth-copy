import type { TypedView } from "../view/typed-view";
import styles from "./typed-sheet.module.css";
import { TypingChars } from "./typing-chars";

/**
 * The typed sheet rising out of the machine's slot (#558, bible 7.7a): what has been typed so far, on paper, with the
 * caret cell where the next letter lands (`chars[0..cursor]`, never the text still to type). The newest
 * line sits just above the slot; older lines leave over the top. A visual echo of the strip, hidden from
 * assistive tech. Server-renderable: it holds no state.
 */
export function TypedSheet({ view }: { view: TypedView }) {
  const typed = view.chars.slice(0, view.cursor + 1);
  return (
    <div className={styles.sheet} data-sheet aria-hidden="true">
      <div className={styles.lines}>
        <p className={styles.copy}>
          <TypingChars chars={typed} last={view.cursor - 1} stamp={view.lastTypedAt} words />
        </p>
      </div>
    </div>
  );
}
