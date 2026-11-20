/**
 * The counted rule of a just-filed result (#931, #999 C35, C41), pure: the same as `countedWhere` for
 * stored ones. A human desk, no anti-cheat flag (ADR 0008), finished or out of time. The race of a
 * filed chunk is counted by construction (the filing route sets ALL_FINISHED or TIMER in the same
 * transaction).
 */

/** The statuses a counted result has (#931): a desk that finished or ran out of time. */
export const COUNTED_STATUSES = ["FINISHED", "TIMED_OUT"] as const;

/** The fields of a filed result the rule reads (`FiledResult` of the results feature). */
export type CountableResult = {
  isBot: boolean;
  suspicious: boolean;
  status: string;
};

/** A counted result: never a bot's, never a flagged one, finished or timed out. */
export function isCountedResult(r: CountableResult): boolean {
  return !r.isBot && !r.suspicious && (COUNTED_STATUSES as readonly string[]).includes(r.status);
}
