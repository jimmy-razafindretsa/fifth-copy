"use client";

import { useMemo } from "react";
import { useRaceStore } from "../../client/use-race-store";
import {
  plaqueRows,
  RankPlaques,
  type PlaqueLabels,
} from "../../components/spectator/rank-plaques";

/** The plaques over the spectator store (#999 C4): every desk of the roster with its live rank. */
export function RankPlaquesLive({ labels }: { labels: PlaqueLabels }) {
  const members = useRaceStore((s) => s.members);
  const ranks = useRaceStore((s) => s.ranks);
  const rows = useMemo(() => plaqueRows(members, ranks), [members, ranks]);
  return <RankPlaques rows={rows} labels={labels} />;
}
