import { effectiveText, untypedBaseWords, wordsOf } from "../text/overlay";
import { finishIfDone, type PlayerState } from "../reducers/state";
import type { BonusKind, Rng, TextOverlay } from "../types";
import { pickInt } from "../testing/rng";

/**
 * Catch-up bonuses (spec 10, ADR 0007, ADR 0016): who may hold which card, what playing it does,
 * and the cooldown and repeat-immunity predicates. Pure: the race server orchestrates (eligibility
 * each tick, `bonus:play`, bot auto-play) and applies the outcome as the authority.
 * Extension point: a new bonus is one `BonusKind` member, one `BONUS_RULES` row and one effect.
 */

/** Words Extra Paperwork appends to the leader's text. */
export const EXTRA_WORDS = 5;
/** Untyped base words Exemption removes from the sender's own text. */
export const EXEMPT_WORDS = 5;
/** How long Smoke Break blurs the desks ahead (ms). */
export const BLUR_MS = 5_000;
/** One play per desk per this many ms, shared across kinds. */
export const COOLDOWN_MS = 15_000;
/** Below this many desks nobody is eligible (a duel has no catch-up). */
export const MIN_BONUS_DESKS = 3;
/** Longest word Extra Paperwork appends (the wire's `textOverlaySchema` word bound). */
export const MAX_EXTRA_WORD_LENGTH = 64;

/** One desk as the effects see it, in live order (best first). */
export type BonusDesk = {
  readonly desk: number;
  readonly state: PlayerState;
  /** The furthest cursor the desk ever had in its effective text (>= `state.cursor`). */
  readonly reach: number;
  readonly overlay: TextOverlay;
  /** The hostile kind that hit this desk last (repeat immunity), else null. */
  readonly lastHitBy: BonusKind | null;
};

export type BonusInput = {
  /** The sender's desk. */
  readonly from: number;
  /** Every desk of the race in live order, best first (`rank`). */
  readonly ranks: readonly BonusDesk[];
  /** The normalised base text. */
  readonly base: string;
  /** Ms since GO. */
  readonly now: number;
  readonly rng: Rng;
  /** Bound on `extra` and `removed` (the wire's `MAX_OVERLAY_WORDS`). */
  readonly maxOverlayWords: number;
};

/**
 * One desk changed by a play. `overlay`: its full overlay after the hit (null when unchanged);
 * `state`: its state when the hit finished it (exemption to the end), else null; `blurUntil`:
 * ms since GO (smoke break), else null.
 */
export type BonusHit = {
  readonly desk: number;
  readonly overlay: TextOverlay | null;
  readonly state: PlayerState | null;
  readonly blurUntil: number | null;
};

/** One play: `t` ms since GO, `to` the hit desks in live order. */
export type BonusEvent = {
  readonly t: number;
  readonly kind: BonusKind;
  readonly from: number;
  readonly to: readonly number[];
};

export type BonusOutcome = { readonly event: BonusEvent; readonly hits: readonly BonusHit[] };

type Effect = (input: BonusInput, targets: readonly BonusDesk[]) => BonusHit[];

type BonusRule = {
  /** Minimum rank percentile, inclusive. */
  readonly threshold: number;
  /** Hits other desks: subject to repeat immunity, counted as received by the targets. */
  readonly hostile: boolean;
  /** The candidate targets in live order (the sender never names one). */
  readonly targets: (input: BonusInput) => BonusDesk[];
  readonly effect: Effect;
};

const typing = (d: BonusDesk) => d.state.status === "typing";

/** Typing desks ranked ahead of the sender, best first. */
function ahead({ from, ranks }: BonusInput): BonusDesk[] {
  const at = ranks.findIndex((d) => d.desk === from);
  return (at < 0 ? [] : ranks.slice(0, at)).filter(typing);
}

const extraPaperwork: Effect = ({ base, rng, maxOverlayWords }, targets) => {
  const pool = wordsOf(base).filter((w) => w.length > 0 && w.length <= MAX_EXTRA_WORD_LENGTH);
  if (pool.length === 0) return [];
  return targets
    .filter((d) => d.overlay.extra.length + EXTRA_WORDS <= maxOverlayWords)
    .map((d) => {
      const words = Array.from({ length: EXTRA_WORDS }, () => pool[pickInt(rng, pool.length)]!);
      return {
        desk: d.desk,
        overlay: { extra: [...d.overlay.extra, ...words], removed: [...d.overlay.removed] },
        state: null,
        blurUntil: null,
      };
    });
};

const exemption: Effect = ({ base, now, maxOverlayWords }, targets) =>
  targets.flatMap((d) => {
    const room = maxOverlayWords - d.overlay.removed.length;
    const reach = Math.max(d.reach, d.state.cursor);
    const drop = untypedBaseWords(base, d.overlay, reach).slice(0, Math.min(EXEMPT_WORDS, room));
    if (drop.length === 0) return [];
    const overlay = { extra: [...d.overlay.extra], removed: [...d.overlay.removed, ...drop] };
    // Never true while `untypedBaseWords` keeps the text longer than `reach`: a guard only.
    const finished = finishIfDone(d.state, effectiveText(base, overlay).length, now);
    return [
      { desk: d.desk, overlay, state: finished === d.state ? null : finished, blurUntil: null },
    ];
  });

const smokeBreak: Effect = ({ now }, targets) =>
  targets.map((d) => ({ desk: d.desk, overlay: null, state: null, blurUntil: now + BLUR_MS }));

/** The one bonus table (spec 10 values; ADR 0016 records them for the teacher to tune). */
export const BONUS_RULES: Readonly<Record<BonusKind, BonusRule>> = {
  "extra-paperwork": {
    threshold: 0.5,
    hostile: true,
    // The best-ranked typing desk ahead of the sender: "the leader".
    targets: (input) => ahead(input).slice(0, 1),
    effect: extraPaperwork,
  },
  exemption: {
    threshold: 0.67,
    hostile: false,
    targets: ({ from, ranks }) => ranks.filter((d) => d.desk === from && typing(d)),
    effect: exemption,
  },
  "smoke-break": {
    threshold: 0.75,
    hostile: true,
    targets: ahead,
    effect: smokeBreak,
  },
};

/** Strongest first: the order `eligibleBonus` tries the thresholds in. */
const BY_STRENGTH = (Object.keys(BONUS_RULES) as BonusKind[]).sort(
  (a, b) => BONUS_RULES[b].threshold - BONUS_RULES[a].threshold,
);

/** `(rank - 1) / (n - 1)` for a 1-based live `rank` among `n >= 2` desks; 0 for `n < 2`. */
export function rankPct(rank: number, n: number): number {
  return n < 2 ? 0 : (rank - 1) / (n - 1);
}

/**
 * The card a desk at `pct` (its `rankPct`) among `n` desks may be dealt: null for the leader and
 * when `n < MIN_BONUS_DESKS`, else the strongest kind whose threshold `pct` meets (inclusive).
 */
export function eligibleBonus(pct: number, n: number): BonusKind | null {
  if (n < MIN_BONUS_DESKS || !(pct > 0)) return null;
  return BY_STRENGTH.find((kind) => pct >= BONUS_RULES[kind].threshold) ?? null;
}

/** Cooldown: a desk that last played at `lastPlayedAt` (ms since GO, null: never) may play at `now`. */
export function canPlay(lastPlayedAt: number | null, now: number): boolean {
  return lastPlayedAt === null || now - lastPlayedAt >= COOLDOWN_MS;
}

/** Repeat immunity: a desk last hit by a hostile `kind` cannot be hit by it again. */
export function canHit(kind: BonusKind, lastHitBy: BonusKind | null): boolean {
  return !BONUS_RULES[kind].hostile || lastHitBy !== kind;
}

/**
 * Plays `kind` for `input.from`: targets from the live order (typing desks only, never the sender
 * for a hostile kind, immune ones dropped), then the effect. Null when nothing would happen (no
 * target, every target immune, an overlay at its bound, no word left to exempt): the caller refuses
 * the play and the card is kept. Cooldown and holding the card are the caller's checks (`canPlay`).
 */
export function applyBonus(kind: BonusKind, input: BonusInput): BonusOutcome | null {
  const rule = BONUS_RULES[kind];
  const targets = rule.targets(input).filter((d) => canHit(kind, d.lastHitBy));
  const hits = targets.length ? rule.effect(input, targets) : [];
  if (hits.length === 0) return null;
  return { event: { t: input.now, kind, from: input.from, to: hits.map((h) => h.desk) }, hits };
}

export function isHostile(kind: BonusKind): boolean {
  return BONUS_RULES[kind].hostile;
}
