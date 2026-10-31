import { cleanAndAdjustedWpm, EMPTY_OVERLAY, elapsedFor } from "@fifth-copy/engine";
import type { RacePhase, RaceState } from "../client/store";

/**
 * The nixie counters' two numbers (#225, design bible 7.11, spec 6.1): pure projections of the race
 * store, no React, no timers. The live leaf (`nixie-counters-live.tsx`) samples `selectWpm` on a
 * bounded clock and reads `selectPlace`'s primitives.
 */

/** The phases in which your typing counts: from GO on (a cut line mid-race keeps your figure). */
const COUNTING: ReadonlySet<RacePhase> = new Set(["running", "ended", "reconnecting"]);

/**
 * Your clean WPM (ADR 0016) as the nixie shows it: the engine's `cleanAndAdjustedWpm(...).clean` over
 * your predicted state (#559), rounded. `now` is this device's clock: race time is
 * `now + clockOffset - race.t0`, the corrected clock of #214, so a starved timer only delays the next
 * sample, never the value. The scoring time follows the engine's `elapsedFor` the way the race server
 * ranks (`elapsedOf`): the live race time while you type, your finishing key's `finishedAt` once you
 * finish (frozen), your last key for a desk that stopped otherwise. `0` before GO, for a spectator and
 * before the race text arrives. #240 extension point: once the store knows the race end, cap the race
 * time at it here.
 */
export function selectWpm(state: RaceState, now: number): number {
  const { race, prediction } = state;
  if (!race || !prediction || !COUNTING.has(state.phase)) return 0;
  const p = prediction.state;
  const raceElapsed = now + state.clockOffset - race.t0;
  const elapsed = elapsedFor(p, p.status === "typing" ? raceElapsed : p.lastT);
  const { clean } = cleanAndAdjustedWpm(p, race.text, state.overlay ?? EMPTY_OVERLAY, elapsed);
  return Math.round(clean);
}

export type NixiePlace = {
  /** 1 = leading; `0` before the first snapshot (and for a spectator). */
  place: number;
  /** The seated typists, bots included. */
  total: number;
};

/**
 * Your place out of the seated typists: your index in the last snapshot's `ranks` (ADR 0006, the
 * server's live order, #173), kept between snapshots; `place = 0` before the first one (a `countdown`
 * clears the ranks). A fresh object per call: React leaves read its fields, never the object.
 */
export function selectPlace(state: RaceState): NixiePlace {
  const place = state.you === null ? 0 : state.ranks.indexOf(state.you) + 1;
  return { place, total: state.members.length };
}
