"use client";

import { useState, useSyncExternalStore } from "react";
import { useRaceStore, useRaceStoreApi } from "../client/use-race-store";
import { selectPlace, selectRemaining, selectWpm } from "../view/counters";
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

/** A sampled value over the store and the clock (the WPM, the timer's seconds: #225, #240). */
export type Sampler<T> = {
  subscribe(listener: () => void): () => void;
  read(): T;
};

/** You are typing in a running race: the only time the figure moves with the clock. */
const typingNow = (s: RaceState) =>
  s.phase === "running" && s.prediction?.state.status === "typing";

/**
 * A value as a tiny external store on a bounded clock (#225 C2, generalised by #240; the
 * `watchStampExpiry` pattern: the race store's subscription plus an injected timer). While `ticking`
 * holds it samples `select(state, timer.now())` every `periodMs` and notifies only when the value
 * changed (`Object.is`); other store changes never notify on their own (that is the throttle). Any store
 * change that stops `ticking` stops the clock and takes one sample; with `sampleOnStart` the one that
 * starts it takes one too (the timer shows its full time at the countdown, not a period later). The value is always recomputed from
 * the store and the clock, never counted from ticks, so a starved timer (a heavy 3D frame) only delays
 * the next sample.
 */
export function createSampler<T>(
  store: RaceStore,
  {
    select,
    ticking,
    periodMs,
    sampleOnStart = false,
    timer = deviceTimer,
  }: {
    select: (state: RaceState, now: number) => T;
    ticking: (state: RaceState) => boolean;
    periodMs: number;
    sampleOnStart?: boolean;
    timer?: SamplerTimer;
  },
): Sampler<T> {
  let value = select(store.getState(), timer.now());
  const listeners = new Set<() => void>();
  let pending: unknown = null;
  let offStore: (() => void) | null = null;

  const sample = () => {
    const next = select(store.getState(), timer.now());
    if (Object.is(next, value)) return;
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
      if (pending === null) {
        if (sampleOnStart) sample();
        pending = timer.setTimeout(tick, periodMs);
      }
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

/** The WPM tube's sampler (#225 C2): `selectWpm` every `WPM_SAMPLE_MS` while you type. */
export function createWpmSampler(
  store: RaceStore,
  { periodMs = WPM_SAMPLE_MS, timer }: { periodMs?: number; timer?: SamplerTimer } = {},
): WpmSampler {
  return createSampler(store, { select: selectWpm, ticking: typingNow, periodMs, timer });
}

/** The timer tube's sampling period (#240): the seconds change once a second; 4 looks a second keeps
 * the two pages of C4 within a quarter second of the server clock. */
export const TIMER_SAMPLE_MS = 250;

/** The race clock runs: counting down to GO or racing, with a timer (`selectRemaining` moves). */
const timerRuns = (s: RaceState) =>
  (s.phase === "countdown" || s.phase === "running") && (s.race?.timerS ?? null) !== null;

/** The timer tube's sampler (#240 C1): `selectRemaining` every `TIMER_SAMPLE_MS` while the clock runs. */
export function createRemainingSampler(
  store: RaceStore,
  { periodMs = TIMER_SAMPLE_MS, timer }: { periodMs?: number; timer?: SamplerTimer } = {},
): Sampler<number | null> {
  return createSampler(store, {
    select: selectRemaining,
    ticking: timerRuns,
    periodMs,
    sampleOnStart: true,
    timer,
  });
}

const serverWpm = () => 0;
const serverRemaining = () => null;

/**
 * The nixie counters over the race store (#225, design bible 7.11, spec 6.1): your clean WPM from the
 * sampler and your place `04 / 30` from the server's ranks. Place 0 (before the first snapshot) reads
 * `00 / n` with the no-place words (bible 7.11, 14 seat view). With a timer the third tube reads the
 * time left (#240, `selectRemaining`), absent without one. On the server and during hydration it is the
 * before-start state.
 */
export function NixieCountersLive({ labels }: { labels: NixieLabels }) {
  const store = useRaceStoreApi();
  const [sampler] = useState(() => createWpmSampler(store));
  const wpm = useSyncExternalStore(sampler.subscribe, sampler.read, serverWpm);
  const [clock] = useState(() => createRemainingSampler(store));
  const remainingS = useSyncExternalStore(clock.subscribe, clock.read, serverRemaining);
  const place = useRaceStore((s) => selectPlace(s).place);
  const total = useRaceStore((s) => selectPlace(s).total);
  return (
    <NixieCounters
      wpm={wpm}
      place={place === 0 ? null : place}
      total={total}
      remainingS={remainingS}
      labels={labels}
    />
  );
}
