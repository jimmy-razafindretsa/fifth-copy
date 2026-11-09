"use client";

import { useId, useRef, useState } from "react";
import { Alert, Stamp } from "@/components/ui";
import styles from "./auth.module.css";

/** The strings of the recovery card (the catalogs' `auth.recovery.reveal`, ADR 0010). */
export type RecoveryCardLabels = {
  listName: string;
  stamp: string;
  warningTitle: string;
  warning: string;
  warningOther: string;
  warningOtherLang: string;
  copy: string;
  copied: string;
  copiedStatus: string;
  selectedStatus: string;
  ack: string;
  continue: string;
};

type CopyState = "idle" | "copied" | "selected";

/**
 * The one-time recovery card (#46 C2, bible 14.3 "Recovery code"): the ink `ISSUED` stamp, the
 * bilingual 7.4 error-tone warning (a lost code is a lost account), the 10 words as a numbered 7.4
 * multi-cell grid, the 7.1 secondary COPY button (clipboard, else the words are selected), the
 * "I wrote it down" checkbox, and the stamp submit that stays unavailable until it is ticked. The
 * continue is `action` (a server action form: the reveal's acknowledgement) or a link to `href`.
 * Never stores the words (no storage, no URL); copy announces through a polite status region.
 */
export function RecoveryCard({
  words,
  labels,
  action,
  href,
  inset = true,
}: {
  words: readonly string[];
  /** false inside an already padded docket section (the `/recover` success state). */
  inset?: boolean;
  labels: RecoveryCardLabels;
  action?: (form: FormData) => void;
  href?: string;
}) {
  const id = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const [ack, setAck] = useState(false);
  const [copy, setCopy] = useState<CopyState>("idle");

  const onCopy = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(words.join(" "));
        setCopy("copied");
        return;
      }
    } catch {
      // no permission or an insecure context: select the words instead
    }
    const list = listRef.current;
    const selection = window.getSelection();
    if (list && selection) {
      selection.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(list);
      selection.addRange(range);
    }
    setCopy("selected");
  };

  const continueLabel = labels.continue;
  return (
    <div className={inset ? styles.section : "flex flex-col gap-4"} data-recovery-card>
      <div className={styles.stampSlot}>
        <Stamp
          lines={[labels.stamp]}
          tone="ink"
          size="md"
          rotation="auto"
          seed="recovery"
          role={null}
        />
      </div>
      <Alert tone="error" title={labels.warningTitle}>
        <p>{labels.warning}</p>
        <p lang={labels.warningOtherLang} className="mt-2">
          {labels.warningOther}
        </p>
      </Alert>
      <ol ref={listRef} className={styles.words} aria-label={labels.listName} data-recovery-words>
        {words.map((word, i) => (
          <li key={i} className={styles.word}>
            <span className={styles.wordIndex} aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className={styles.wordText}>{word}</span>
          </li>
        ))}
      </ol>
      <button type="button" className={styles.secondary} onClick={onCopy}>
        {copy === "copied" ? labels.copied : labels.copy}
      </button>
      <p role="status" className="sr-only">
        {copy === "copied" ? labels.copiedStatus : copy === "selected" ? labels.selectedStatus : ""}
      </p>
      <label htmlFor={`${id}-ack`} className={styles.ack}>
        <input
          id={`${id}-ack`}
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
        />
        {labels.ack}
      </label>
      {action ? (
        <form action={action}>
          <button type="submit" className={styles.submit} disabled={!ack}>
            {continueLabel}
          </button>
        </form>
      ) : (
        <a
          href={href}
          className={`${styles.submit} ${styles.submitLink}`}
          aria-disabled={!ack || undefined}
          onClick={(e) => {
            if (!ack) e.preventDefault();
          }}
        >
          {continueLabel}
        </a>
      )}
    </div>
  );
}
