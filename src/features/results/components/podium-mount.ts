/**
 * The plinth clerks' staggered mount (#688 C4, bible 14.4 "Plinth clerk", 12): three software-WebGL realms
 * booting in one task froze the page for ~9 s in CI (#300), so the frames mount one at a time in place
 * order. Plinth n+1 may mount once plinth n is done: its clerk reported ready (`fc-clerk`), or
 * `PLINTH_MOUNT_GAP_MS` passed since plinth n was allowed to mount, or it has no frame at all (`UNFILLED`,
 * `UNDER REVIEW`). Pure: the client provider (`plinth-mounts.tsx`) feeds it events and runs the one timer.
 */
import type { PodiumPlace } from "../view/dawn-report";

/** How long a plinth waits for the previous clerk's ready signal before it mounts anyway. */
export const PLINTH_MOUNT_GAP_MS = 2_000;

/** One plinth: its place and whether its slot holds a clerk frame. */
export type MountSlot = { place: PodiumPlace; frame: boolean };

/** `ready`: the plinth's clerk posted its first `fc-clerk`. `timeout`: its gap elapsed. */
export type MountEvent = { type: "ready" | "timeout"; place: PodiumPlace };

export type MountState = {
  /** The plinths allowed to mount, in place order. */
  mounted: PodiumPlace[];
  /** The mounted plinth still holding the next one back (its timer runs), or null when none is. */
  waiting: PodiumPlace | null;
};

/** Which plinths may mount after `events`, for `slots` in place order. */
export function plinthMountState(
  slots: readonly MountSlot[],
  events: readonly MountEvent[],
): MountState {
  const mounted: PodiumPlace[] = [];
  for (const slot of slots) {
    if (!slot.frame) continue;
    mounted.push(slot.place);
    const done = events.some(
      (e) => e.place === slot.place && (e.type === "ready" || e.type === "timeout"),
    );
    if (!done) return { mounted, waiting: slot.place };
  }
  return { mounted, waiting: null };
}
