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
} from "./podium-mount";

type Mounts = { mounted: readonly PodiumPlace[]; ready: (place: PodiumPlace) => void };

// Outside a provider every plinth mounts at once (a lone specimen).
const MountsContext = createContext<Mounts | null>(null);

/**
 * The podium's staggered mount (#688 C4): holds the plinth frames back so they boot one at a time in
 * place order (`plinthMountState`), with one timer for the plinth currently being waited on. The
 * `Podium` stays a server component; this provider and `PlinthClerk` are its only client parts.
 */
export function PlinthMounts({
  slots,
  children,
}: {
  slots: readonly MountSlot[];
  children: ReactNode;
}) {
  const [events, setEvents] = useState<readonly MountEvent[]>([]);
  const { mounted, waiting } = useMemo(() => plinthMountState(slots, events), [slots, events]);
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
