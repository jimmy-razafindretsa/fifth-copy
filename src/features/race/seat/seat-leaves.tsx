"use client";

import { useSyncExternalStore } from "react";
import { fill } from "@/i18n/format";
import { selectRaceCardView, selectTypedView } from "../client/store";
import { useRaceStore } from "../client/use-race-store";
import { AbandonControl } from "../components/abandon-control";
import { NixieCounters } from "../components/nixie-counters";
import { RaceCard } from "../components/race-card";
import { TelexStrip, type TelexLabels } from "../components/telex-strip";
import { TypedSheet } from "../components/typed-sheet";
import type { AbandonLabels, NixieLabels, RaceCardLabels } from "../view/hud-labels";
import { COMPACT_QUERY, paperwork, type RaceSeatLabels } from "./seat-view";
import styles from "./race-seat.module.css";

/**
 * The HUD leaves that read the race store (#561, ADR 0013: one store, the HUD reads it). Each renders
 * the before-start state on the server (the store's server snapshot) and follows the room after the
 * welcome. The typing surface follows your prediction (#559), the race card the snapshots (#564); WPM
 * and place arrive later; Abandon wakes up with #233.
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

/** WPM `00` and place `00 / n` before the start: n is the seated typists (bible 7.11). */
export function SeatNixie({ labels }: { labels: NixieLabels }) {
  const total = useRaceStore((s) => s.members.length);
  return <NixieCounters wpm={0} place={null} total={total} labels={labels} />;
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

const noop = () => {};

/** Always visible, inert before GO (bible 7.1, spec 4.4); #233 sends the intent. */
export function SeatAbandon({ labels }: { labels: AbandonLabels }) {
  return (
    <AbandonControl
      state="disabled"
      onAbandon={noop}
      onConfirm={noop}
      onCancel={noop}
      labels={labels}
    />
  );
}
