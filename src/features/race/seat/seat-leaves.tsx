"use client";

import { useMemo } from "react";
import { fill } from "@/i18n/format";
import { useRaceStore } from "../client/use-race-store";
import { AbandonControl } from "../components/abandon-control";
import { NixieCounters } from "../components/nixie-counters";
import { RaceCard } from "../components/race-card";
import type { AbandonLabels, NixieLabels, RaceCardLabels } from "../view/hud-labels";
import { beforeStartRaceCard, paperwork, type RaceSeatLabels } from "./seat-view";
import styles from "./race-seat.module.css";

/**
 * The HUD leaves that read the race store (#561, ADR 0013: one store, the HUD reads it). Each renders
 * the before-start state on the server (the store's server snapshot) and follows the room after the
 * welcome. Snapshots, ranks and WPM arrive with #559 and #564; Abandon wakes up with #233.
 */

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

/** The race card before the start: everyone on the line at the start, no lanes yet (#564). */
export function SeatRaceCard({ labels }: { labels: RaceCardLabels }) {
  const members = useRaceStore((s) => s.members);
  const you = useRaceStore((s) => s.you);
  const view = useMemo(() => beforeStartRaceCard(members, you), [members, you]);
  return <RaceCard view={view} labels={labels} />;
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
