"use client";

import { ROOM_SEATS, SeatRing } from "@/features/lobby/client";
import { useRaceStore } from "@/features/race";
import type { Messages } from "@/i18n";

/**
 * The phone spectator's compact overview (#999 C10; bible 14.3 "Phone spectator"): the lobby's CSS seat
 * ring diagram drawn from the race store's roster, with no `you` (no desk on a phone). Never three.js
 * (ADR 0013: no scene on phones). Empty until the room answers.
 */
export function WatchRing({ labels }: { labels: Messages["lobby"]["ring"] }) {
  const members = useRaceStore((s) => s.members);
  const known = useRaceStore((s) => s.room !== null);
  return known ? (
    <SeatRing members={members} you={null} seats={ROOM_SEATS} labels={labels} />
  ) : null;
}
