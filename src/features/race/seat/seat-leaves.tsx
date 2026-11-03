"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { fill } from "@/i18n/format";
import { selectAbandonState, selectRaceCardView, selectTypedView } from "../client/store";
import { useRaceStore, useRaceStoreApi } from "../client/use-race-store";
import { AbandonControl } from "../components/abandon-control";
import { RaceCard } from "../components/race-card";
import { TelexStrip, type TelexLabels } from "../components/telex-strip";
import { TypedSheet } from "../components/typed-sheet";
import type { AbandonLabels, RaceCardLabels } from "../view/hud-labels";
import { COMPACT_QUERY, paperwork, type RaceSeatLabels } from "./seat-view";
import styles from "./race-seat.module.css";

/**
 * The HUD leaves that read the race store (#561, ADR 0013: one store, the HUD reads it). Each renders
 * the before-start state on the server (the store's server snapshot) and follows the room after the
 * welcome. The typing surface follows your prediction (#559), the race card the snapshots (#564), the
 * nixie counters both (`NixieCountersLive`, #225), Abandon the store's gate (#233).
 */

/** The telex strip over your desk's typed view (#559): empty until the race text arrives. */
export function SeatTelex({ labels }: { labels: TelexLabels }) {
  const view = useRaceStore(selectTypedView);
  return <TelexStrip view={view} labels={labels} />;
}

/** The typed sheet over the same view. */
export function SeatSheet() {
  const view = useRaceStore(selectTypedView);
  return <TypedSheet view={view} />;
}

/** The page heading: `SEAT VIEW`, then `SEAT VIEW · DESK 05` once the room seats you. */
export function SeatKicker({ labels }: { labels: RaceSeatLabels["kicker"] }) {
  const you = useRaceStore((s) => s.you);
  return (
    <h1 className={styles.kicker}>
      {you === null ? labels.seat : fill(labels.desk, { n: paperwork(you) })}
    </h1>
  );
}

/** `matchMedia(query)` as external state; `false` on the server and during hydration. */
function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * The race card over the store (#564): every typist on the full-field line (at the start until the
 * first snapshot), the lanes selected from the snapshots, one view per snapshot (`selectRaceCardView`).
 * Compact below 1280px (bible 7.4a: tablets and small laptops).
 */
export function SeatRaceCard({ labels }: { labels: RaceCardLabels }) {
  const view = useRaceStore(selectRaceCardView);
  const compact = useMedia(COMPACT_QUERY);
  return <RaceCard view={view} labels={labels} compact={compact} />;
}

/**
 * Abandon over the store (#233 C2, bible 7.1, spec 4.4): always visible, inert unless you may type (before
 * GO, after your finish or exit, while an intent is in flight). The confirm is local: ABANDON opens it,
 * the ink `CONFIRM · REASSIGN ME` dispatches `abandon` (the store takes it once and the seat's socket
 * sends it, `sendAbandons`), and ABANDON again, `Escape` or 5 s close it. A disabled control shows no
 * confirm.
 */
export function SeatAbandon({ labels }: { labels: AbandonLabels }) {
  const store = useRaceStoreApi();
  const gate = useRaceStore(selectAbandonState);
  const [confirming, setConfirming] = useState(false);
  const open = useCallback(() => setConfirming(true), []);
  const cancel = useCallback(() => setConfirming(false), []);
  const confirm = useCallback(() => {
    setConfirming(false);
    store.dispatch({ type: "abandon" });
  }, [store]);
  // a confirm left open when the store disables the control (GO of the next race, an exit) is gone
  if (gate === "disabled" && confirming) setConfirming(false);
  const state = gate === "disabled" ? "disabled" : confirming ? "confirm" : "idle";
  return (
    <AbandonControl
      state={state}
      onAbandon={open}
      onConfirm={confirm}
      onCancel={cancel}
      labels={labels}
    />
  );
}
