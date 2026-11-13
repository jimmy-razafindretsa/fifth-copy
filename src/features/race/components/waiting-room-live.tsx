"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRaceStore } from "../client/use-race-store";
import { arrivalOrder, arrivedDesks, waitingRoomView } from "../view/waiting-room-view";
import { WaitingRoom, type WaitingRoomLabels } from "./waiting-room";

export type WaitingRoomLiveProps = {
  labels: WaitingRoomLabels;
  /** `race.notice.reconnecting`: the row shown while the line is cut (C7). */
  reconnecting: string;
  tip: string | null;
};

/**
 * The waiting room's client leaf (#937): while the room is `loading` (#926) and the line is not lost,
 * it reads the store's slices (each stable for a given state), keeps the arrival order (newest first,
 * client-only: the wire carries only the awaited desks), and portals the screen over the seat view,
 * whose HUD is `inert` meanwhile (nothing behind the cover takes focus). Renders nothing otherwise.
 */
export function WaitingRoomLive({ labels, reconnecting, tip }: WaitingRoomLiveProps) {
  const roomPhase = useRaceStore((s) => s.room?.phase ?? null);
  const code = useRaceStore((s) => s.room?.code ?? null);
  const phase = useRaceStore((s) => s.phase);
  const settings = useRaceStore((s) => s.settings);
  const you = useRaceStore((s) => s.you);
  const members = useRaceStore((s) => s.members);
  const pending = useRaceStore((s) => s.pending);
  const raceIn = useRaceStore((s) => s.race !== null);
  const sceneSettled = useRaceStore((s) => s.sceneSettled);

  const shown = roomPhase === "loading" && pending !== null && phase !== "lost";
  const arrived = useMemo(() => arrivedDesks(members, pending), [members, pending]);
  const [order, setOrder] = useState<readonly number[]>([]);
  // the arrival order follows each readiness report; reset when the room leaves `loading`
  const next = shown ? arrivalOrder(order, arrived) : [];
  if (next !== order && (shown || order.length > 0)) setOrder(next);

  const view = useMemo(
    () =>
      waitingRoomView(
        {
          code,
          settings: settings && { language: settings.language, textType: settings.textType },
          you,
          members,
          pending,
          raceIn,
          sceneSettled,
        },
        order,
      ),
    [code, settings, you, members, pending, raceIn, sceneSettled, order],
  );

  useEffect(() => {
    if (!shown) return;
    const seat = document.querySelector("[data-seat]");
    seat?.setAttribute("inert", "");
    return () => seat?.removeAttribute("inert");
  }, [shown]);

  if (!shown || typeof document === "undefined") return null;
  return createPortal(
    <WaitingRoom
      labels={labels}
      view={view}
      notice={phase === "reconnecting" ? reconnecting : null}
      tip={tip}
    />,
    document.body,
  );
}
