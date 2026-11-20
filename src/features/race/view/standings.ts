import { charsOf, normalizeTypeable } from "@fifth-copy/engine";
import type { EndReason, PLAYER_STATUSES, RankingEntry } from "@fifth-copy/protocol";

type PlayerStatus = (typeof PLAYER_STATUSES)[number];
import { fill } from "@/i18n/format";
import { identityOfDesk } from "@/lib/rival-identity";
import {
  projectLanes,
  rankOrder,
  selectField,
  type Lane,
  type MarkerInk,
  type MarkerShape,
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

/** The projector's sidebar holds at most this many rows (#999 C3, bible 14.3 "Projector view"). */
export const TOP_TEN = 10;

/**
 * One row of the projector's top-10 sidebar (#999 C3): the place (`null` before the first snapshot: the
 * roster by desk, no place yet), the desk, the name, the desk's identity marker, and the figure: the
 * status word when the desk is not typing, else the value (`72 %` live; `null` before the race); once
 * the race is over, `52 WPM` alone (bible 14.3: no status word at RACE OVER). Never a `you`: the projector holds no desk, and even the host's own desk is a rival ink.
 */
export type TopTenRow = {
  place: number | null;
  desk: number;
  name: string;
  marker: { shape: MarkerShape; colour: MarkerInk };
  value: string | null;
  status: string | null;
};

/** What the sidebar reads: the race card's fields plus the server's `ended` (its final ranking). */
export type TopTenSource = Omit<RaceCardSource, "you"> & {
  readonly ending: { readonly reason: EndReason; readonly ranking: readonly RankingEntry[] } | null;
};

/**
 * The projector's top 10 (#999 C3, bible 14.3 "Projector view"): after the end, the server's final
 * ranking as sent (`finalRows`); while racing, the live standings in the server's rank order
 * (`selectStandings` + `liveRows`, engine progress, ADR 0007); before the first snapshot, the roster by
 * desk with no place. Cut to `TOP_TEN`; every desk in its rival identity (#565), none as `you`. Pure.
 */
export function topTenRows(source: TopTenSource, labels: FinishLabels): TopTenRow[] {
  const roster = new Map(source.members.map((m) => [m.desk, m]));
  const marker = (desk: number) => {
    const { colour, shape } = identityOfDesk(desk, roster, null);
    return { colour, shape };
  };
  const { ending } = source;
  if (ending && ending.ranking.length > 0) {
    return finalRows(ending.ranking.slice(0, TOP_TEN), ending.reason, null, labels).map((r) => ({
      place: r.place,
      desk: r.desk,
      name: r.name,
      marker: marker(r.desk),
      value: r.value,
      status: null,
    }));
  }
  const lanes = selectStandings({ ...source, you: null }).slice(0, TOP_TEN);
  if (lanes.length > 0) {
    const rows = liveRows(lanes, labels);
    return lanes.map((l, i) => ({
      place: l.rank,
      desk: l.desk,
      name: l.name,
      marker: l.marker,
      value: rows[i]!.value,
      status: rows[i]!.status,
    }));
  }
  return source.members.slice(0, TOP_TEN).map((m) => ({
    place: null,
    desk: m.desk,
    name: m.name,
    marker: marker(m.desk),
    value: null,
    status: null,
  }));
}
