import { charsOf, normalizeTypeable } from "@fifth-copy/engine";
import type { EndReason, PLAYER_STATUSES, RankingEntry } from "@fifth-copy/protocol";

type PlayerStatus = (typeof PLAYER_STATUSES)[number];
import { fill } from "@/i18n/format";
import {
  projectLanes,
  rankOrder,
  selectField,
  type Lane,
  type RaceCardSource,
} from "./race-card-view";

/**
 * The finished view's standings (#240, design bible 7.4, spec 4.1 rules 5-6): pure projections the
 * `FinishedView` docket renders. No race rule here (ADR 0007): the live order is the server's `ranks`,
 * progress the engine's (`raceCardViewFrom`), and the final ranking is `ended.ranking` as sent.
 */

/** The `race.finish` copy (both catalogs; `{n}` placeholders filled with `fill`). */
export type FinishLabels = {
  /** The docket's tag once you finished, while the race runs: `FILED` / `CLASSÉ`. */
  filed: string;
  /** The docket's tag once the server ended the race: `RACE OVER` / `COURSE TERMINÉE`. */
  over: string;
  /** The mono value of the ended docket: why it ended (`void` never reaches this docket, #661). */
  reason: Record<Exclude<EndReason, "void">, string>;
  /** The standings list's accessible name. */
  standings: string;
  /** Paperwork desk number: `DESK {n}`. */
  desk: string;
  /** The ink tag on your row. */
  you: string;
  /** A live row's figure: `{n} %` typed (no-break space). */
  progress: string;
  /** A final row's figure: `{n} WPM` (clean WPM, ADR 0016). */
  wpm: string;
  /** Status words (bible 7.4a, 14.4); `typing` reads `TIMED OUT` once the timer ended the race. */
  status: Record<PlayerStatus, string>;
  /** The ink button to the Dawn report: `DAWN REPORT →`. */
  report: string;
};

/** One docket row: place, desk, name, the figure, the status word (`null` = none). */
export type StandingRow = {
  place: number;
  desk: number;
  name: string;
  you: boolean;
  value: string;
  status: string | null;
};

type Memo = Omit<RaceCardSource, "desks"> & { lanes: Lane[] };
const memo = new WeakMap<object, Memo>();

/**
 * Every desk of the race by the server's live rank (#240 C2): the race card's projection
 * (`projectLanes`) over its ordering rule (`rankOrder`), without the card's 8-lane window (bible 7.4a):
 * the docket lists all desks. Empty before the race or its first snapshot. Memoised per snapshot,
 * roster, you and race: the same array on every re-read, so a key re-renders no docket.
 */
export function selectStandings(source: RaceCardSource): Lane[] {
  const { members, you, desks, ranks, race } = source;
  const hit = memo.get(desks);
  if (hit && hit.members === members && hit.you === you && hit.ranks === ranks && hit.race === race)
    return hit.lanes;
  const lanes =
    !race || desks.length === 0
      ? []
      : projectLanes(
          source,
          selectField(desks, charsOf(normalizeTypeable(race.text)).length, you),
          rankOrder(desks, ranks).map((desk, i) => ({ desk, rank: i + 1 })),
        );
  memo.set(desks, { members, you, ranks, race, lanes });
  return lanes;
}

const percent = (p: number) => Math.round(Math.min(1, Math.max(0, p)) * 100);

/** The live standings as docket rows (#240 C2): rank, `DESK nn`, name, `72 %`, the lane status. */
export function liveRows(lanes: readonly Lane[], labels: FinishLabels): StandingRow[] {
  return lanes.map((l) => ({
    place: l.rank,
    desk: l.desk,
    name: l.name,
    you: l.you,
    value: fill(labels.progress, { n: percent(l.progress) }),
    status: l.status === "typing" ? null : labels.status[l.status],
  }));
}

/**
 * The final standings as docket rows (#240 C3): `ended.ranking` as sent (place, desk, name, `wpm`
 * rounded), the status in words. A desk still typing when the timer ended it reads `TIMED OUT` (the
 * results' `TIMED_OUT`, bible 14.4); after an all-finished end it shows none.
 */
export function finalRows(
  ranking: readonly RankingEntry[],
  reason: EndReason | null,
  you: number | null,
  labels: FinishLabels,
): StandingRow[] {
  return ranking.map((e) => ({
    place: e.place,
    desk: e.desk,
    name: e.name,
    you: e.desk === you,
    value: fill(labels.wpm, { n: Math.round(e.wpm) }),
    status: e.status === "typing" && reason !== "timer" ? null : labels.status[e.status],
  }));
}
