import type { Member } from "@fifth-copy/protocol";
import type { RoomEvents } from "./socket";

/**
 * The overtake stamps' queue (#232, bible 7.3, 8, 14.3): pure helpers the race store's `event` and
 * `stamp-expired` cases call. No race rule here (ADR 0007): the server decides who passed whom; the
 * queue only paces what the seat view shows. Extension point: bonus stamps are one more `StampKind` and
 * one more case in `stampFromEvent` (the finish stamps of #240 are two).
 */

/**
 * The stamps the seat view shows: you passed someone (red), someone passed you (ink); your finish
 * (#240, bible 7.7): `accepted` with zero errors (red, you), `returned` with errors (ink, paperwork);
 * the host left for good and the room promoted a typist (#868, bible 14.3: ink, `NEW HOST: <NAME>`).
 */
export type StampKind = "overtake" | "passed" | "accepted" | "returned" | "new-host";

export type RaceStamp = {
  /** Unique within a page (a counter): the row's key and the stamp's angle seed. */
  id: number;
  kind: StampKind;
  /** This device's clock when the server's event arrived. */
  at: number;
  /** The other desk: the one you passed, or the one that passed you (your own desk on a finish). */
  other: number;
  /** Your errors at the finish (`returned` reads them); 0 for every other kind. */
  errors: number;
  /** The new host's name as the roster held it when the event came (`new-host` only). */
  name?: string;
  /** When it shows (or showed): `at` alone, else the moment the stamp before it expires. */
  shownAt: number;
};

/** How long a stamp stays once it shows. */
export const STAMP_SHOW_MS = 1_400;
/**
 * How long the NEW HOST notice stays (#868 C2): the UI's slow duration x 5 (`--motion-duration-slow`,
 * 600 ms in tokens.css, so 3 s), as the lobby's stamp of #137; the same 3 s under reduced motion, since
 * the notice is news, not motion (bible 14.3).
 */
export const NEW_HOST_SHOW_MS = 3_000;
/** A second event of the same kind this soon after the newest queued one is dropped. */
export const STAMP_COLLAPSE_MS = 300;

/** How long a stamp of this kind stays once it shows. */
export const stampShowMs = (kind: StampKind): number =>
  kind === "new-host" ? NEW_HOST_SHOW_MS : STAMP_SHOW_MS;

const expiresAt = (stamp: RaceStamp) => stamp.shownAt + stampShowMs(stamp.kind);

type StampOf = { kind: StampKind; other: number; errors: number; name?: string };

/**
 * The NEW HOST notice for `event new-host { desk }` (#868 C1): the desk's name from the roster, or
 * `null` for a desk the roster does not hold (the event is then ignored).
 */
export function newHostStamp(
  payload: Extract<RoomEvents["event"], { kind: "new-host" }>,
  members: readonly Member[],
): StampOf | null {
  const host = members.find((m) => m.desk === payload.desk);
  return host ? { kind: "new-host", other: host.desk, errors: 0, name: host.name } : null;
}

/**
 * The queue's stamp for one server event about your desk, or `null` (another kind, another desk).
 * `errors` is your predicted desk's error count (ADR 0007: the engine's, over the local state): the
 * server's `finished` of your desk is `accepted` with none, `returned` otherwise.
 */
export function stampFromEvent(
  payload: RoomEvents["event"],
  you: number | null,
  errors = 0,
): StampOf | null {
  if (you === null) return null;
  switch (payload.kind) {
    case "overtake":
      return payload.desk === you ? { kind: "overtake", other: payload.passed, errors: 0 } : null;
    case "passed":
      return payload.desk === you ? { kind: "passed", other: payload.by, errors: 0 } : null;
    case "finished":
      if (payload.desk !== you) return null;
      return errors === 0
        ? { kind: "accepted", other: you, errors: 0 }
        : { kind: "returned", other: you, errors };
    default:
      return null;
  }
}

/** The queue without the stamps that expired by `now` (the visible one first; a pending one follows). */
export function dropExpired(stamps: readonly RaceStamp[], now: number): readonly RaceStamp[] {
  let i = 0;
  while (i < stamps.length && expiresAt(stamps[i]!) <= now) i++;
  return i === 0 ? stamps : stamps.slice(i);
}

/**
 * Queues a stamp: at most one visible (`[0]`) plus one pending (`[1]`, the latest wins). A stamp of the
 * same kind as the newest queued one within `STAMP_COLLAPSE_MS` collapses into it. A visible NEW HOST
 * notice gives way at once: whatever arrives while it shows replaces it (#868 C2). Returns the same
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
  if (!visible || visible.kind === "new-host") return [{ ...stamp, shownAt: stamp.at }];
  return [visible, { ...stamp, shownAt: expiresAt(visible) }];
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
