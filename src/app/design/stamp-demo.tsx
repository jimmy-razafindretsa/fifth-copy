"use client";

import { useState, useSyncExternalStore } from "react";
import { Button, Stamp } from "@/components/ui";

/**
 * #26 C6: the replayable stamp of /design. A client leaf only for the Replay button: it remounts the
 * stamp by key, and counts `onSettled` per mount on `data-stamp-settled` (read by e2e/stamp.spec.ts).
 * `data-stamp-demo` reads "ready" once hydration has committed (#822): e2e touches the stamp only then,
 * or React reports the test's DOM edits as a hydration mismatch.
 */
const noSubscribe = () => () => {};
export function StampReplay() {
  const [run, setRun] = useState(0);
  const [settled, setSettled] = useState(0);
  // false while hydrating (server snapshot), true on the re-render after the hydration commit
  const ready = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  return (
    <div
      data-stamp-demo={ready ? "ready" : "server"}
      data-stamp-run={run}
      data-stamp-settled={settled}
      className="flex max-w-full flex-col items-start gap-4"
    >
      <Stamp
        key={run}
        size="lg"
        rotation="auto"
        seed="overtake"
        lines={[
          <>
            <span lang="ru">ОБГОН!</span> · OVERTAKE
          </>,
          "DÉPASSEMENT",
        ]}
        onSettled={() => setSettled((n) => n + 1)}
      />
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setSettled(0);
          setRun((r) => r + 1);
        }}
      >
        Replay
      </Button>
    </div>
  );
}
