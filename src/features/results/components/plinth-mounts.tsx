"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Outfit } from "../embed-messages";
import type { MedalVariant, PodiumPlace } from "../view/dawn-report";
import { PodiumClerk } from "./podium-clerk";
import {
  PLINTH_MOUNT_GAP_MS,
  plinthMountState,
  type MountEvent,
  type MountSlot,
  type MountState,
} from "./podium-mount";

/**
 * How long the podium itself holds the first clerk back once it is on screen (#690 C2). A clerk's boot
 * (three.js, PMREM, first frame) takes the page's thread for seconds on software WebGL (the frames share
 * the page's process); mounting the first one in the swap's own commit froze the page right as the
 * podium swapped in. The podium counts as the place before plinth 1: it gets one gap to settle.
 */
export const PODIUM_SETTLE_MS = PLINTH_MOUNT_GAP_MS;

/** The mount state while the podium settles (none mounted, no timer), then the queue's. */
export function heldMountState(
  settled: boolean,
  slots: readonly MountSlot[],
  events: readonly MountEvent[],
): MountState {
  return settled ? plinthMountState(slots, events) : { mounted: [], waiting: null };
}

type Mounts = { mounted: readonly PodiumPlace[]; ready: (place: PodiumPlace) => void };

// Outside a provider every plinth mounts at once (a lone specimen).
const MountsContext = createContext<Mounts | null>(null);

/**
 * The podium's staggered mount (#688 C4): holds the plinth frames back so they boot one at a time in
 * place order (`plinthMountState`), after the podium's own settle gap (`PODIUM_SETTLE_MS`), with one
 * timer for the plinth currently being waited on. The `Podium` stays a server component; this provider
 * and `PlinthClerk` are its only client parts.
 */
export function PlinthMounts({
  slots,
  children,
}: {
  slots: readonly MountSlot[];
  children: ReactNode;
}) {
  const [settled, setSettled] = useState(false);
  const [events, setEvents] = useState<readonly MountEvent[]>([]);
  const { mounted, waiting } = useMemo(
    () => heldMountState(settled, slots, events),
    [settled, slots, events],
  );
  const ready = useCallback(
    (place: PodiumPlace) =>
      setEvents((prev) =>
        prev.some((e) => e.place === place && e.type === "ready")
          ? prev
          : [...prev, { type: "ready", place }],
      ),
    [],
  );

  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), PODIUM_SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (waiting === null) return;
    const timer = setTimeout(
      () => setEvents((prev) => [...prev, { type: "timeout", place: waiting }]),
      PLINTH_MOUNT_GAP_MS,
    );
    return () => clearTimeout(timer);
  }, [waiting]);

  const value = useMemo(() => ({ mounted, ready }), [mounted, ready]);
  return <MountsContext value={value}>{children}</MountsContext>;
}

type PlinthClerkProps = {
  place: PodiumPlace;
  variant: MedalVariant;
  outfit: Outfit;
  title: string;
  fallback: string;
  still: boolean;
};

/** One plinth's clerk, mounted when `PlinthMounts` lets its place through. */
export function PlinthClerk({ place, ...props }: PlinthClerkProps) {
  const mounts = useContext(MountsContext);
  const ready = mounts?.ready;
  const onReady = useCallback(() => ready?.(place), [ready, place]);
  const mount = mounts ? mounts.mounted.includes(place) : true;
  return <PodiumClerk {...props} mount={mount} onReady={onReady} />;
}
