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
 * before the race text arrives. Once the server ended the race (#240) the race time stops at its end
 * (`raceEndMs`), so a desk still typing at RACE OVER keeps its figure.
 */
export function selectWpm(state: RaceState, now: number): number {
  const { race, prediction } = state;
  if (!race || !prediction || !COUNTING.has(state.phase)) return 0;
  const end = raceEndMs(state);
  const raceElapsed = now + state.clockOffset - race.t0;
  return wpmAt(state, end === null ? raceElapsed : Math.min(raceElapsed, end));
}

/** The engine's clean WPM of your predicted desk at race time `raceElapsed` (the one formula). */
function wpmAt(state: RaceState, raceElapsed: number): number {
  const { race, prediction } = state;
  if (!race || !prediction) return 0;
  const p = prediction.state;
  const elapsed = elapsedFor(p, p.status === "typing" ? raceElapsed : p.lastT);
  const { clean } = cleanAndAdjustedWpm(p, race.text, state.overlay ?? EMPTY_OVERLAY, elapsed);
  return Math.round(clean);
}

/**
 * Your finish figure (#240, bible 7.7 `ACCEPTED · {wpm} WPM`): `selectWpm`'s frozen value at your
 * finishing key (the engine's `finishedAt`); `0` without a prediction. It reads no clock, so the stamp
 * and the WPM tube agree.
 */
export function selectFinishWpm(state: RaceState): number {
  const p = state.prediction?.state;
  return p ? wpmAt(state, p.lastT) : 0;
}

/**
 * The race time (ms since GO, server clock) at which the server ended the race (#240): exactly the timer
 * when its `reason` is `timer` (the offset estimate may read the arrival a little early), otherwise the
 * arrival of `ended` on the corrected clock, capped at the timer; `null` while the race has not ended
 * here (or a reload found it ended: no arrival time).
 */
export function raceEndMs(state: RaceState): number | null {
  const { race, endedAt } = state;
  if (!race || state.phase !== "ended" || endedAt === null) return null;
  const timerMs = race.timerS === null ? null : race.timerS * 1000;
  if (timerMs !== null && state.ending?.reason === "timer") return timerMs;
  const end = endedAt + state.clockOffset - race.t0;
  return timerMs === null ? end : Math.min(end, timerMs);
}

/**
 * The timer tube's seconds (#240 C1, bible 7.11): `null` without a timer (`race.timerS` null, or no race
 * yet); otherwise the seconds left to `race.t0 + race.timerS` on the corrected clock (#214), rounded up,
 * clamped to `0..timerS` (it reads the full time before GO), frozen at `raceEndMs` once ended. The server
 * decides the end (ADR 0006): at 0 the tube waits for its `ended`.
 */
export function selectRemaining(state: RaceState, now: number): number | null {
  const { race } = state;
  if (!race || race.timerS === null) return null;
  const end = raceEndMs(state);
  const elapsed = end ?? now + state.clockOffset - race.t0;
  const leftS = Math.ceil((race.timerS * 1000 - elapsed) / 1000);
  return Math.min(race.timerS, Math.max(0, leftS));
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
