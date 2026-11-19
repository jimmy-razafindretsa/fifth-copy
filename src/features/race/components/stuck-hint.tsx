import type { MouseEvent } from "react";
import { cn } from "@/lib/cn";
import docket from "./hud-docket.module.css";
import styles from "./stuck-hint.module.css";

/** The stuck hint's copy (#999 C31): `{char}` is the character the typist keeps missing. */
export type StuckHintLabels = {
  /** `STUCK ON {char}?` / `BLOQUÉ SUR {char} ?` */
  stuck: string;
  /** `HERE'S HOW →` / `VOICI COMMENT →`, the link to the guide's entry. */
  how: string;
};

export type StuckHintProps = {
  char: string;
  /** `/guide#c-cedilla`: the guide's entry for the character. */
  href: string;
  labels: StuckHintLabels;
  /** A click on the link (the hint goes once the new tab opened). */
  onDismiss?: () => void;
};

/** A pointer press never moves the focus out of the race input (the abandon control's recipe). */
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * The in-race stuck hint (#999 C31, spec 14, bible 7.4 notice row): `STUCK ON ç? HERE'S HOW →`, its
 * link opening the guide's entry for the character in a new tab, so the race keeps its page. A polite
 * `status`; the character keeps its own case. When it shows and when it goes is `StuckHintLive`'s.
 */
export function StuckHint({ char, href, labels, onDismiss }: StuckHintProps) {
  const [before = "", after = ""] = labels.stuck.split("{char}");
  return (
    <p
      role="status"
      data-notice="stuck-hint"
      data-char={char}
      className={cn(docket.notice, styles.hint)}
    >
      {before}
      <span className={styles.char}>{char}</span>
      {after}{" "}
      <a
        href={href}
        target="_blank"
        rel="noopener"
        className={styles.link}
        onMouseDown={keepFocus}
        // the link must still be in the page when the browser follows it: the hint goes right after
        onClick={() => {
          if (onDismiss) setTimeout(onDismiss, 0);
        }}
      >
        {labels.how}
      </a>
    </p>
  );
}
