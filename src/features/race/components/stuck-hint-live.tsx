"use client";

import { useEffect, useState } from "react";
import { useRaceStore } from "../client/use-race-store";
import { selectStuckChar, STUCK_HINT_MS, stuckHintHref } from "../view/stuck-hint";
import { StuckHint, type StuckHintLabels } from "./stuck-hint";

const NO_ERRORS: ReadonlyMap<string, number> = new Map();
const NONE: ReadonlySet<string> = new Set();

/**
 * The stuck hint over the store (#999 C30, C31): when the prediction's `errorsByChar` puts a special
 * character at 3 wrong presses, the hint shows for it, once per character in this race (the caller keys
 * this leaf by the race), and goes after `STUCK_HINT_MS` or a click on its link. It reads the store only:
 * the race input keeps the focus.
 */
export function StuckHintLive({ labels }: { labels: StuckHintLabels }) {
  const errorsByChar = useRaceStore((s) =>
    s.phase === "running" ? (s.prediction?.errorsByChar ?? NO_ERRORS) : NO_ERRORS,
  );
  const [hinted, setHinted] = useState<ReadonlySet<string>>(NONE);
  const [shown, setShown] = useState<string | null>(null);
  // a new stuck character: it shows now and is hinted for the rest of the race (state adjusted in render)
  const stuck = selectStuckChar(errorsByChar, hinted);
  if (stuck !== null) {
    setHinted(new Set([...hinted, stuck]));
    setShown(stuck);
  }
  useEffect(() => {
    if (shown === null) return;
    const handle = setTimeout(() => setShown(null), STUCK_HINT_MS);
    return () => clearTimeout(handle);
  }, [shown]);
  const href = shown === null ? null : stuckHintHref(shown);
  if (shown === null || href === null) return null;
  return <StuckHint char={shown} href={href} labels={labels} onDismiss={() => setShown(null)} />;
}
