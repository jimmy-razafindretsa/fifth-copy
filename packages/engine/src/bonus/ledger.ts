import type { BonusKind } from "../types";
import type { BonusEvent } from "./rules";

/** One (sender, target) pair of a play, as stored in a result's `bonusLog` (`t`: ms since GO). */
export type BonusLogEntry = {
  readonly t: number;
  readonly kind: BonusKind;
  readonly from: number;
  readonly to: number;
};

/**
 * One desk's bonus history: plays sent, hits received from other desks, and every log entry it is
 * part of (sender or target), at most `MAX_LOG_ENTRIES` (the counters keep counting past it).
 */
export type BonusLedger = {
  readonly sent: number;
  readonly received: number;
  readonly log: readonly BonusLogEntry[];
};

/** The wire's bound on a result's `bonusLog`. */
export const MAX_LOG_ENTRIES = 1_024;

export const EMPTY_LEDGER: BonusLedger = { sent: 0, received: 0, log: [] };

/** One log entry per target of the play (a smoke break hitting three desks is three entries). */
export function logOf(event: BonusEvent): BonusLogEntry[] {
  return event.to.map((to) => ({ t: event.t, kind: event.kind, from: event.from, to }));
}

/**
 * `desk`'s ledger after `event`: `sent` + 1 when it played, `received` + 1 when another desk hit
 * it (an exemption on oneself is sent, not received), the entries it is part of appended.
 */
export function record(ledger: BonusLedger, desk: number, event: BonusEvent): BonusLedger {
  const mine = logOf(event).filter((e) => e.from === desk || e.to === desk);
  if (mine.length === 0) return ledger;
  const hit = event.from !== desk && event.to.includes(desk);
  return {
    sent: ledger.sent + (event.from === desk ? 1 : 0),
    received: ledger.received + (hit ? 1 : 0),
    log: [...ledger.log, ...mine].slice(0, MAX_LOG_ENTRIES),
  };
}
