"use client";

import { useEffect, useState } from "react";
import { Button, Stamp } from "@/components/ui";
import { clearMergedFlash } from "../merge/flash-cookie";
import styles from "./merge-stamp.module.css";

export type MergeStampDocketProps = {
  races: number;
  /** The stamp's headline, `FILED` / `CLASSÉ`. */
  title: string;
  /** The stamp's second line, `3 RACES CARRIED`. */
  carried: string;
  /** The sentence under the stamp. */
  sentence: string;
  dismiss: string;
};

/**
 * The merge stamp docket (#57, bible 7.3, 7.4 extension): a 7.4 docket pinned to the bottom of the
 * viewport, named by its stamp, never a dialog (no focus move, no trap; the exit dockets' recipe). The ink
 * `Stamp` at `md` at its seeded angle slams in (still under reduced motion), clipped by its band; the
 * sentence; the secondary `DISMISS` closes it. The one-shot cookie is cleared once it has rendered.
 */
export function MergeStampDocket({
  races,
  title,
  carried,
  sentence,
  dismiss,
}: MergeStampDocketProps) {
  const [open, setOpen] = useState(true);
  useEffect(() => clearMergedFlash(), []);
  if (!open) return null;
  return (
    <section aria-label={title} data-merge-stamp={races} className={styles.docket}>
      <div className={styles.stamp}>
        <Stamp
          size="md"
          tone="ink"
          rotation="auto"
          seed={`merge-${races}`}
          lines={[title, carried]}
        />
      </div>
      <p className={styles.sentence}>{sentence}</p>
      <div className={styles.actions}>
        <Button variant="secondary" className="min-h-11" onClick={() => setOpen(false)}>
          {dismiss}
        </Button>
      </div>
    </section>
  );
}
