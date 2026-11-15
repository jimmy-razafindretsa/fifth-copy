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

  // #951: also while the page connects (from the server's first paint), so no other loading screen
  // shows before it
  const shown =
    phase === "connecting" || (roomPhase === "loading" && pending !== null && phase !== "lost");
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

  const percent = useSmoothPercent(view.percent, shown, view.current === null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!shown) return null;
  const screen = (
    <WaitingRoom
      labels={labels}
      view={{ ...view, percent }}
      notice={phase === "reconnecting" ? reconnecting : null}
      tip={tip}
    />
  );
  // before hydration the cover is inline (fixed, over the seat); after, portalled beside the inert seat
  return mounted ? createPortal(screen, document.body) : screen;
}

/** How often the shown percent moves toward its target (a number change, not an animation). */
const TICK_MS = 150;

/**
 * The progress the bar shows (#951): it never goes back, catches up quickly with the real percent
 * (`target`), then keeps creeping toward the next step's share (20 points ahead, never past 97) while
 * the device waits, ever slower, so a long load still moves. Done reads 100 at once.
 */
export function nextPercent(shownNow: number, target: number, done: boolean): number {
  if (done) return 100;
  if (shownNow < target) return Math.min(target, shownNow + Math.max(1, (target - shownNow) * 0.25));
  const ceiling = Math.min(97, target + 19);
  if (shownNow >= ceiling) return shownNow;
  return Math.min(ceiling, shownNow + Math.max(0.05, (ceiling - shownNow) * 0.03));
}

function useSmoothPercent(target: number, active: boolean, done: boolean): number {
  const [shownNow, setShown] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(
      () => setShown((now) => nextPercent(now, target, done)),
      TICK_MS,
    );
    return () => window.clearInterval(id);
  }, [active, target, done]);
  return Math.round(shownNow);
}
