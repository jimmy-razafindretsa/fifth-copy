"use client";

import { ROOM_SEATS, SeatRing } from "@/features/lobby/client";
import { useRaceStore } from "@/features/race";
import type { Messages } from "@/i18n";

/**
 * The projector's stage (#999 C6; bible 14.3 "Projector view"): the paper fallback, the lobby's seat ring
 * diagram drawn from the spectator store's roster with no `you` (the projector holds no desk). The ring
 * reaches the race route through the lobby's light client door (`race` never imports `lobby`). The
 * overview scene (`camera: "over"`, C2) and its plaques mount here for a WebGL2 browser in the next step
 * of #999 (M3b); until then every projector stays on paper.
 */
export function ProjectorStage({ labels }: { labels: Messages["lobby"]["ring"] }) {
  const members = useRaceStore((s) => s.members);
  const known = useRaceStore((s) => s.room !== null);
  return (
    <div data-scene="paper" className="contents">
      {known ? <SeatRing members={members} you={null} seats={ROOM_SEATS} labels={labels} /> : null}
    </div>
  );
}
