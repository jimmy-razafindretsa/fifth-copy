"use client";

import { useState, useSyncExternalStore } from "react";
import { useRaceStore, useRaceStoreApi } from "../client/use-race-store";
import { selectPlace, selectWpm } from "../view/counters";
import type { NixieLabels } from "../view/hud-labels";
import { NixieCounters } from "./nixie-counters";

// The components' one door to the client is the store's React binding (#220 C2, imports.test.ts): the
// store's types are read off it.
type RaceStore = ReturnType<typeof useRaceStoreApi>;
type RaceState = ReturnType<RaceStore["getState"]>;
/** The device clock and timers (the shape of the store's `RaceTimer`, injected in tests). */
export type SamplerTimer = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

/** The WPM tube's sampling period: at most 4 renders a second while you type (#225 C2). */
export const WPM_SAMPLE_MS = 250;

const deviceTimer: SamplerTimer = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type WpmSampler = {
  /** Returns the unsubscribe; the clock runs only while someone reads. */
  subscribe(listener: () => void): () => void;
  /** The last sampled WPM, stable between samples (a `useSyncExternalStore` snapshot). */
  read(): number;
};

/** You are typing in a running race: the only time the figure moves with the clock. */
const ticking = (s: RaceState) => s.phase === "running" && s.prediction?.state.status === "typing";

/**
 * The WPM as a tiny external store on a bounded clock (#225 C2; the `watchStampExpiry` pattern: the
 * race store's subscription plus an injected timer). While you type in a running race it samples
 * `selectWpm(state, timer.now())` every `periodMs` and notifies only when the integer changed;
 * keystrokes never notify (that is the throttle). Any other store change (GO not yet passed, your
 * finishing key, the phase leaving running) stops the clock and takes one sample. The value is always
 * recomputed from the store and the clock, never counted from ticks, so a starved timer (a heavy 3D
 * frame) only delays the next sample.
 */
export function createWpmSampler(
  store: RaceStore,
  {
    periodMs = WPM_SAMPLE_MS,
    timer = deviceTimer,
  }: { periodMs?: number; timer?: SamplerTimer } = {},
): WpmSampler {
  let value = selectWpm(store.getState(), timer.now());
  const listeners = new Set<() => void>();
  let pending: unknown = null;
  let offStore: (() => void) | null = null;

  const sample = () => {
    const next = selectWpm(store.getState(), timer.now());
    if (next === value) return;
    value = next;
    for (const listener of [...listeners]) listener();
  };
  const stopClock = () => {
    if (pending !== null) timer.clearTimeout(pending);
    pending = null;
  };
  const tick = () => {
    pending = null;
    sample();
    if (ticking(store.getState())) pending = timer.setTimeout(tick, periodMs);
  };
  const onStore = () => {
    if (ticking(store.getState())) {
      if (pending === null) pending = timer.setTimeout(tick, periodMs);
      return;
    }
    stopClock();
    sample();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!offStore) {
        offStore = store.subscribe(onStore);
        sample();
        onStore();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0 || !offStore) return;
        offStore();
        offStore = null;
        stopClock();
      };
    },
    read: () => value,
  };
}

const serverWpm = () => 0;

/**
 * The nixie counters over the race store (#225, design bible 7.11, spec 6.1): your clean WPM from the
 * sampler and your place `04 / 30` from the server's ranks. Place 0 (before the first snapshot) reads
 * `00 / n` with the no-place words (bible 7.11, 14 seat view). On the server and during hydration it is
 * the before-start state.
 */
export function NixieCountersLive({ labels }: { labels: NixieLabels }) {
  const store = useRaceStoreApi();
  const [sampler] = useState(() => createWpmSampler(store));
  const wpm = useSyncExternalStore(sampler.subscribe, sampler.read, serverWpm);
  const place = useRaceStore((s) => selectPlace(s).place);
  const total = useRaceStore((s) => selectPlace(s).total);
  return (
    <NixieCounters wpm={wpm} place={place === 0 ? null : place} total={total} labels={labels} />
  );
}
