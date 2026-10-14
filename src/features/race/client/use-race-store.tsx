"use client";

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRaceStore, initialRaceState, type RaceState, type RaceStore } from "./store";

const RaceStoreContext = createContext<RaceStore | null>(null);

/**
 * Holds the seat view's one race store (#561, ADR 0013) for every HUD leaf under it, and later the
 * scene (#563). The race route renders it on the server around server-rendered children; it creates
 * its own store unless one is given (tests, /design specimens).
 */
export function RaceStoreProvider({
  store,
  children,
}: {
  store?: RaceStore;
  children?: ReactNode;
}) {
  const [own] = useState(() => store ?? createRaceStore());
  return <RaceStoreContext value={own}>{children}</RaceStoreContext>;
}

/** The store itself, for the leaf that connects and dispatches (`RaceSeatLive`). */
export function useRaceStoreApi(): RaceStore {
  const store = useContext(RaceStoreContext);
  if (!store) throw new Error("useRaceStore needs a RaceStoreProvider above it");
  return store;
}

/**
 * One value of the race state, re-rendering when it changes (`useSyncExternalStore`). On the server and
 * during hydration it reads the initial state (the server snapshot), so the HTML is the before-start
 * seat. The selector returns a slice or a primitive (a value that is stable for a given state); derive
 * anything else with `useMemo` in the leaf.
 */
export function useRaceStore<T>(selector: (state: RaceState) => T): T {
  const store = useRaceStoreApi();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(initialRaceState),
  );
}
