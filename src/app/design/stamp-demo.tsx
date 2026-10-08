"use client";

import { useState } from "react";
import { Button, Stamp } from "@/components/ui";

/**
 * #26 C6: the replayable stamp of /design. A client leaf only for the Replay button: it remounts the
 * stamp by key, and counts `onSettled` per mount on `data-stamp-settled` (read by e2e/stamp.spec.ts).
 */
export function StampReplay() {
  const [run, setRun] = useState(0);
  const [settled, setSettled] = useState(0);
  return (
    <div
      data-stamp-demo
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
