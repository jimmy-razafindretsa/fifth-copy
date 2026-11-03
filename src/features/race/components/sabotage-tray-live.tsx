"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { useRaceStore, useRaceStoreApi } from "../client/use-race-store";
import type { SabotageTrayLabels } from "../view/hud-labels";
import { createSampler, type Sampler, type SamplerTimer } from "./nixie-counters-live";
import { SabotageTray } from "./sabotage-tray";

// The components' one door to the client is the store's React binding (imports.test.ts): the store's
// types are read off it.
type RaceStore = ReturnType<typeof useRaceStoreApi>;
type RaceState = ReturnType<RaceStore["getState"]>;

/** The cooldown's seconds change once a second (#236 C3). */
export const COOLDOWN_SAMPLE_MS = 1_000;

/** Whole seconds left on your cooldown at `now` (device clock), 0 when none or over. */
export function cooldownSecondsAt(state: RaceState, now: number): number {
  const until = state.bonus.cooldownUntil;
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1_000));
}

/** The cooldown can move: a race runs and a cooldown was set (the sampler stops otherwise). */
const cooling = (s: RaceState) => s.phase === "running" && s.bonus.cooldownUntil !== null;

/** The tray's seconds (#236 C3): `cooldownSecondsAt` once a second while a cooldown may run. */
export function createCooldownSampler(
  store: RaceStore,
  { periodMs = COOLDOWN_SAMPLE_MS, timer }: { periodMs?: number; timer?: SamplerTimer } = {},
): Sampler<number> {
  return createSampler(store, {
    select: cooldownSecondsAt,
    ticking: cooling,
    periodMs,
    sampleOnStart: true,
    timer,
  });
}

const serverSeconds = () => 0;

/** The host turned bonuses off for this room (`settings.bonuses === false`): no tray at all (#236 C3). */
export const trayHidden = (s: RaceState) => s.settings?.bonuses === false;

/**
 * The Sabotage tray over the race store (#236 C3, bible 7.4, spec 10): the card `bonus-earned` dealt
 * you, the hint `ENTER TO PLAY` and the `PLAY CARD` button while it is ready, the cooldown seconds
 * counting down once a second, and the `IMMUNE` row after a refused play. Enter (the race input) and
 * the button both dispatch `bonus-play` with the device clock; the store decides whether it goes out
 * (a card, not cooling, no play in flight) and the seat's socket sends it. A room whose host turned
 * bonuses off shows no tray. It decides nothing about the economy (ADR 0007).
 */
export function SabotageTrayLive({
  labels,
  now = Date.now,
}: {
  labels: SabotageTrayLabels;
  /** The device clock of a play (injected in tests). */
  now?: () => number;
}) {
  const store = useRaceStoreApi();
  const [sampler] = useState(() => createCooldownSampler(store));
  const seconds = useSyncExternalStore(sampler.subscribe, sampler.read, serverSeconds);
  const off = useRaceStore(trayHidden);
  const card = useRaceStore((s) => s.bonus.card);
  const refused = useRaceStore((s) => s.bonus.refused);
  const play = useCallback(() => store.dispatch({ type: "bonus-play", at: now() }), [store, now]);
  if (off) return null;
  return (
    <SabotageTray
      card={card}
      cooldownS={seconds}
      hint={labels.hint}
      labels={labels}
      refused={refused}
      onPlay={play}
    />
  );
}
