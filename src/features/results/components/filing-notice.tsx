"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FilingLabels } from "../view/report-labels";
import { FilingNoticeView } from "./filing-notice-view";

/** Re-read the report every 2 s, for at most 60 s (#300 C2). */
export const FILING_REFRESH_MS = 2_000;
export const FILING_MAX_MS = 60_000;

/**
 * Polls `refresh` every `everyMs` until `maxMs` have passed, then calls `onExpire` once. Returns the stop
 * function. Pure scheduling, so the timing is unit-tested without a browser.
 */
export function startFilingPoll({
  refresh,
  onExpire,
  now = () => Date.now(),
  everyMs = FILING_REFRESH_MS,
  maxMs = FILING_MAX_MS,
}: {
  refresh: () => void;
  onExpire: () => void;
  now?: () => number;
  everyMs?: number;
  maxMs?: number;
}): () => void {
  const started = now();
  const id = setInterval(() => {
    if (now() - started >= maxMs) {
      clearInterval(id);
      onExpire();
      return;
    }
    refresh();
  }, everyMs);
  return () => clearInterval(id);
}

/**
 * The Dawn report while the race server's results are on their way (#300 C2, bible 7.4): the one-row
 * notice `FILING THE REPORT · ONE MOMENT` (`role="status"`, `lkPulse`) and a `router.refresh()` every 2 s,
 * so the server page swaps in the podium as soon as the rows exist. After 60 s it stops and shows the 7.4
 * inline error line with a 7.1 secondary link back.
 */
export function FilingNotice({ labels, backHref }: { labels: FilingLabels; backHref: string }) {
  const router = useRouter();
  const [late, setLate] = useState(false);
  useEffect(
    () => startFilingPoll({ refresh: () => router.refresh(), onExpire: () => setLate(true) }),
    [router],
  );

  return <FilingNoticeView labels={labels} backHref={backHref} late={late} />;
}
