import {
  applyBonus,
  canPlay,
  EMPTY_OVERLAY,
  eligibleBonus,
  isHostile,
  rankPct,
  record,
  type BonusDesk,
  type Rng,
} from "@fifth-copy/engine";
import {
  MAX_OVERLAY_WORDS,
  MAX_RACE_MS,
  PROTOCOL_VERSION,
  type RaceEvent,
  type Rejected,
  type TextOverlay,
} from "@fifth-copy/protocol";
import { withOverlay, type DesksState, type DeskState, type RoomRuntime } from "./desks-state";
import { raceElapsed } from "./live-rank";
import { rankingFor } from "./ranking";

/** A bot plays the card it holds once it has held it this long (ms; spec 10 open question 14). */
export const BOT_HOLD_MS = 3_000;

export type BonusPlayResult = {
  /** Sent back as `rejected`: no race yet, not running (or ending), or nothing playable. */
  rejected?: Extract<Rejected["reason"], "before-go" | "not-running" | "no-bonus">;
  /** A desk turned terminal (the caller asks the lifecycle whether every desk is done). */
  terminal: boolean;
};

export type Bonuses = {
  /** The tick step (`rooms/tick.ts` `TickStep`): deals cards by live rank, plays the bots' cards. */
  step(runtime: RoomRuntime, now: number): void;
  /** `bonus:play` from a seated desk (the socket's seat, never the payload). */
  play(lobbyId: string, desk: number, now: number): BonusPlayResult;
  /** The desk's overlay while its race runs (`welcome.overlay`), else null. */
  overlayOf(lobbyId: string, desk: number): TextOverlay | null;
};

export type BonusEmit = {
  /** `event` to the room (`bonus-sent`). */
  room(lobbyId: string, event: RaceEvent): void;
  /** `event` to one desk's sockets (`bonus-earned`, `bonus-hit`). */
  desk(lobbyId: string, desk: number, event: RaceEvent): void;
};

const v = PROTOCOL_VERSION;
const NONE: BonusPlayResult = { rejected: "no-bonus", terminal: false };

/** Wire copy of an engine overlay (fresh arrays). */
const wire = (overlay: TextOverlay): TextOverlay => ({
  extra: [...overlay.extra],
  removed: [...overlay.removed],
});

/**
 * The bonus economy of a running room (#190; spec 10; ADR 0006, 0007, 0008, 0016). Orchestration
 * only: eligibility, targets, effects, cooldown and immunity are the engine's (`bonus/rules.ts`).
 * Each tick, a typing desk holding no card is dealt `eligibleBonus(rankPct)` from the live ranking
 * (`bonus-earned` to the desk); a bot holding one for `BOT_HOLD_MS` plays it. A play (socket or
 * bot) is refused with `no-bonus`, the card kept, when bonuses are off, the desk is not typing or
 * holds nothing, its cooldown runs, or the engine finds nothing to do (no target, all immune, an
 * overlay at `MAX_OVERLAY_WORDS`, no word to exempt). Otherwise the outcome lands through
 * `desksState.set`: `bonus-sent` to the room, `bonus-hit` to each target with its full overlay or
 * blur. The effective text of an overlaid desk is rebuilt in the runtime (`withOverlay`). Like
 * idle, it stands down once `endRace` marks the runtime `ending`. Synchronous, Redis-free.
 */
export function createBonuses({
  desksState,
  emit,
  rng,
}: {
  desksState: DesksState;
  emit: BonusEmit;
  /** Extra Paperwork's word draw; injected (tests seed it). */
  rng: Rng;
}): Bonuses {
  /** Every desk of the race in live order, as the engine's effects see them. */
  function liveOrder(runtime: RoomRuntime, elapsed: number): BonusDesk[] {
    const ranking = rankingFor(runtime.desks, runtime.states, runtime.textLength, elapsed);
    return ranking.flatMap(({ desk }) => {
      const state = runtime.states.get(desk);
      if (!state) return [];
      return [
        {
          desk,
          state,
          reach: state.reach,
          overlay: state.overlay ?? EMPTY_OVERLAY,
          lastHitBy: state.lastHitBy,
        },
      ];
    });
  }

  function playIn(runtime: RoomRuntime, desk: number, now: number): BonusPlayResult {
    const sender = runtime.states.get(desk);
    if (!runtime.bonuses || sender?.status !== "typing" || !sender.held) return NONE;
    const elapsed = raceElapsed(runtime, now);
    if (!canPlay(sender.lastPlayedAt, elapsed)) return NONE;
    const kind = sender.held.kind;
    const outcome = applyBonus(kind, {
      from: desk,
      ranks: liveOrder(runtime, elapsed),
      base: runtime.text,
      now: elapsed,
      rng,
      maxOverlayWords: MAX_OVERLAY_WORDS,
    });
    if (!outcome) return NONE;

    const { lobbyId } = runtime;
    const { event, hits } = outcome;
    const next = new Map<number, DeskState>();
    const current = (d: number) => next.get(d) ?? runtime.states.get(d)!;
    next.set(desk, { ...sender, held: null, lastPlayedAt: elapsed });
    let terminal = false;
    for (const hit of hits) {
      let state = current(hit.desk);
      if (hit.overlay) state = withOverlay(runtime, hit.desk, state, hit.overlay);
      if (hit.state) {
        state = { ...state, ...hit.state };
        terminal ||= state.status !== "typing";
      }
      if (hit.blurUntil !== null) {
        state = { ...state, blurUntil: Math.min(MAX_RACE_MS, hit.blurUntil) };
      }
      if (isHostile(kind) && hit.desk !== desk) state = { ...state, lastHitBy: kind };
      next.set(hit.desk, state);
    }
    for (const [d, state] of next) {
      desksState.set(lobbyId, d, { ...state, ledger: record(state.ledger, d, event) });
    }

    emit.room(lobbyId, { v, kind: "bonus-sent", from: desk, to: [...event.to], bonus: kind });
    for (const hit of hits) {
      emit.desk(lobbyId, hit.desk, {
        v,
        kind: "bonus-hit",
        desk: hit.desk,
        bonus: kind,
        overlay: hit.overlay ? wire(hit.overlay) : null,
        blurUntil: hit.blurUntil === null ? null : Math.min(MAX_RACE_MS, hit.blurUntil),
      });
    }
    return { terminal };
  }

  return {
    step(runtime, now) {
      if (runtime.phase !== "running" || runtime.ending || !runtime.bonuses) return;
      const { lobbyId } = runtime;
      const order = liveOrder(runtime, raceElapsed(runtime, now));
      const n = order.length;
      order.forEach(({ desk }, i) => {
        const state = runtime.states.get(desk)!;
        if (state.status !== "typing" || state.held) return;
        const kind = eligibleBonus(rankPct(i + 1, n), n);
        if (!kind) return;
        desksState.set(lobbyId, desk, { ...state, held: { kind, since: now } });
        emit.desk(lobbyId, desk, { v, kind: "bonus-earned", desk, bonus: kind });
      });
      // Bots play like humans (open question 14, ADR 0016); a refused play is retried next tick.
      for (const { desk, isBot } of runtime.desks) {
        const held = runtime.states.get(desk)?.held;
        if (isBot && held && now - held.since >= BOT_HOLD_MS) playIn(runtime, desk, now);
      }
    },

    play(lobbyId, desk, now) {
      const runtime = desksState.get(lobbyId);
      if (!runtime) return { rejected: "before-go", terminal: false };
      if (runtime.phase !== "running" || runtime.ending) {
        return { rejected: "not-running", terminal: false };
      }
      return playIn(runtime, desk, now);
    },

    overlayOf(lobbyId, desk) {
      const runtime = desksState.get(lobbyId);
      const overlay = runtime?.phase === "running" ? runtime.states.get(desk)?.overlay : null;
      return overlay ? wire(overlay) : null;
    },
  };
}
