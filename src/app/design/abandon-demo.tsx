"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui";
import { AbandonControl, type AbandonLabels, type AbandonState } from "@/features/race";

const noop = () => {};
const noSubscribe = () => noop;

/** A still specimen of one Abandon state (#560 C7): its handlers do nothing, so `confirm` stays put. */
export function AbandonSpecimen({ state, labels }: { state: AbandonState; labels: AbandonLabels }) {
  return (
    <AbandonControl
      state={state}
      onAbandon={noop}
      onConfirm={noop}
      onCancel={noop}
      labels={labels}
    />
  );
}

/**
 * The Abandon control to try (#560 C5): ABANDON opens the confirm; Escape, ABANDON again or 5 s close it;
 * CONFIRM leaves the control inert, as after a reassignment. The page owns this state; the race store does
 * in the seat view (#233).
 */
export function AbandonDemo({ labels }: { labels: AbandonLabels }) {
  const [state, setState] = useState<AbandonState>("idle");
  // e2e waits for hydration before pressing (the server HTML has no handlers yet): false on the server
  const ready = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  return (
    <div data-abandon-demo={ready ? "ready" : "server"} className="flex flex-col gap-2">
      <AbandonControl
        state={state}
        onAbandon={() => setState("confirm")}
        onConfirm={() => setState("disabled")}
        onCancel={() => setState("idle")}
        labels={labels}
      />
      {state === "disabled" ? (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setState("idle")}>
          Reset the demo
        </Button>
      ) : null}
    </div>
  );
}
