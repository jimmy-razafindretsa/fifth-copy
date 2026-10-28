import type { RoomEvents } from "./socket";

/**
 * The overtake stamps' queue (#232, bible 7.3, 8, 14.3): pure helpers the race store's `event` and
 * `stamp-expired` cases call. No race rule here (ADR 0007): the server decides who passed whom; the
 * queue only paces what the seat view shows. Extension point: the finish stamp (#240) and bonus stamps
 * are one more `StampKind` and one more case in `stampFromEvent`.
 */

/** The stamps the seat view shows: you passed someone (red), someone passed you (ink). */
export type StampKind = "overtake" | "passed";

export type RaceStamp = {
  /** Unique within a page (a counter): the row's key and the stamp's angle seed. */
  id: number;
  kind: StampKind;
  /** This device's clock when the server's event arrived. */
  at: number;
  /** The other desk: the one you passed, or the one that passed you. */
  other: number;
  /** When it shows (or showed): `at` alone, else the moment the stamp before it expires. */
  shownAt: number;
};

/** How long a stamp stays once it shows. */
export const STAMP_SHOW_MS = 1_400;
/** A second event of the same kind this soon after the newest queued one is dropped. */
export const STAMP_COLLAPSE_MS = 300;

/** The queue's stamp for one server event about your desk, or `null` (another kind, another desk). */
export function stampFromEvent(
  payload: RoomEvents["event"],
  you: number | null,
): { kind: StampKind; other: number } | null {
  if (you === null || payload.desk !== you) return null;
  switch (payload.kind) {
    case "overtake":
      return { kind: "overtake", other: payload.passed };
    case "passed":
      return { kind: "passed", other: payload.by };
    default:
      return null;
  }
}

/** The queue without the stamps that expired by `now` (the visible one first; a pending one follows). */
export function dropExpired(stamps: readonly RaceStamp[], now: number): readonly RaceStamp[] {
  let i = 0;
  while (i < stamps.length && stamps[i]!.shownAt + STAMP_SHOW_MS <= now) i++;
  return i === 0 ? stamps : stamps.slice(i);
}

/**
 * Queues a stamp: at most one visible (`[0]`) plus one pending (`[1]`, the latest wins). A stamp of the
 * same kind as the newest queued one within `STAMP_COLLAPSE_MS` collapses into it. Returns the same
 * array when nothing changes.
 */
export function pushStamp(
  queue: readonly RaceStamp[],
  stamp: Omit<RaceStamp, "shownAt">,
): readonly RaceStamp[] {
  const live = dropExpired(queue, stamp.at);
  const newest = live.at(-1);
  if (newest && newest.kind === stamp.kind && stamp.at - newest.at < STAMP_COLLAPSE_MS) return live;
  const visible = live[0];
  if (!visible) return [{ ...stamp, shownAt: stamp.at }];
  return [visible, { ...stamp, shownAt: visible.shownAt + STAMP_SHOW_MS }];
}

/** The visible stamp `id` expired at `now`: the pending one (if any) shows from then. */
export function expireStamp(
  queue: readonly RaceStamp[],
  id: number,
  now: number,
): readonly RaceStamp[] {
  if (queue[0]?.id !== id) return queue;
  const next = queue[1];
  return next ? [{ ...next, shownAt: Math.max(next.shownAt, now) }] : [];
}
