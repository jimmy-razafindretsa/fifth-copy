import { charsOf, normalizeTypeable, progress } from "@fifth-copy/engine";
import {
  deskIdentity,
  MARKERS,
  PLAYER_STATUSES,
  type Marker,
  type Member,
  type Snapshot,
} from "@fifth-copy/protocol";
import { identityOfDesk, rivalIdentity, type IdentityInk } from "./rival-identity";

/**
 * The race card's view model (#560, ADR 0013, design bible 7.4a): "where am I in the race" as data. It is
 * what `RaceCard` renders and nothing else: ranks, progress and statuses arrive from the race server
 * through the store (#564 selects the lanes and projects the snapshot, #565 the per-rival identity); no race
 * rule lives here or in the component (ADR 0007: progress is the engine's own `progress`).
 */

/** The four colour-blind-safe rival marker shapes (spec 6.2, R80): the protocol's `MARKERS`. */
export const MARKER_SHAPES = MARKERS;
export type MarkerShape = Marker;

/**
 * A marker's ink, as a colour role name (never a value): a rival's own ink `rival-0`..`rival-11` (bible
 * 3.1, #565, from `rivalIdentity`) or `you` (agit-red). One CSS mapping each in race-card.module.css.
 */
export type MarkerInk = IdentityInk;

/** A lane's status label; `typing` shows none (spec 4.4, 4.5, 7.4; the lane label, bible 7.4a). */
export const LANE_STATUSES = ["typing", "line-cut", "asleep", "abandoned", "finished"] as const;
export type LaneStatus = (typeof LANE_STATUSES)[number];

/**
 * One tick of the full-field line: every player of the race, `progress` 0..1 (1 = finished), in its
 * identity ink (bible 7.4a: rival ticks wear their ink, the shape stays on the lanes).
 */
export type FieldTick = { desk: number; progress: number; you: boolean; ink: MarkerInk };

/**
 * One lane: a selected player with its name, rank (1 = leading), marker and status. `cursor` is the last
 * snapshot's cursor of the desk (the lane's `data-desk-progress`, #559 C6).
 */
export type Lane = {
  desk: number;
  name: string;
  cursor: number;
  progress: number;
  rank: number;
  status: LaneStatus;
  marker: { shape: MarkerShape; colour: MarkerInk };
  you: boolean;
};

/** `field`: one entry per player, any order. `lanes`: the selected players, in rank order. */
export type RaceCardView = { field: FieldTick[]; lanes: Lane[] };

// Selection and projection (#564, spec 6.2, ADR 0006: ranks and cursors are the last snapshot's).

/** Every player shows up to this many; above it the window of `selectLanes`. */
export const ALL_LANES_UP_TO = 8;
/** Above `ALL_LANES_UP_TO`: the leaders always shown, and your neighbours on each side. */
const TOP = 3;
const NEIGHBOURS = 2;

/** A snapshot desk entry as the selectors read it: the desk number first. */
type DeskEntry = readonly [desk: number, ...rest: number[]];

/** A selected lane before the join: its desk and its 1-based rank. */
export type LaneSlot = { desk: number; rank: number };

/**
 * The lanes shown (#564 C1, spec 6.2, bible 7.4a): every desk when there are 8 or fewer; otherwise the top
 * 3 by rank plus the two ranked just ahead of you and the two just behind (and you), deduplicated, in
 * rank order. The order is the server's `ranks` (a desk repeated or unknown there is dropped, a desk
 * missing from it goes last by desk number). Without a desk (a spectator) above 8: the top 3. Pure.
 */
export function selectLanes(
  desks: readonly DeskEntry[],
  ranks: readonly number[],
  you: number | null,
): LaneSlot[] {
  const order = rankOrder(desks, ranks);
  const all = order.length <= ALL_LANES_UP_TO;
  const at = you === null ? -1 : order.indexOf(you);
  return order.flatMap((desk, i) =>
    all || i < TOP || (at >= 0 && Math.abs(i - at) <= NEIGHBOURS) ? [{ desk, rank: i + 1 }] : [],
  );
}

/**
 * Every snapshot desk in the server's `ranks` order (a desk repeated or unknown there is dropped, a desk
 * missing from it goes last by desk number). The one ordering rule of the card and the standings (#240).
 */
export function rankOrder(desks: readonly DeskEntry[], ranks: readonly number[]): number[] {
  const present = new Set(desks.map((d) => d[0]));
  const order = [...new Set(ranks.filter((d) => present.has(d)))];
  const ranked = new Set(order);
  for (const d of [...present].sort((a, b) => a - b)) if (!ranked.has(d)) order.push(d);
  return order;
}

/**
 * The full-field line (#564 C2): every snapshot desk at the engine's `progress` of its entry (finished =
 * 1, clamped to 0..1, 0 for an empty text), yours marked, each in its identity ink (#565: the roster's
 * `color`, or the desk's allocator identity when the roster lacks it). `textLength` is the base text's
 * (ADR 0016: a rival's lengthened text is not in the snapshot, so its progress clamps at 1 until #236).
 */
export function selectField(
  desks: Snapshot["desks"],
  textLength: number,
  you: number | null = null,
  members: readonly Member[] = [],
): FieldTick[] {
  const roster = new Map(members.map((m) => [m.desk, m]));
  return desks.map(([desk, cursor, , , code]) => ({
    desk,
    progress: progress({ cursor, status: PLAYER_STATUSES[code] ?? "typing" }, textLength),
    you: desk === you,
    ink: identityOfDesk(desk, roster, you).colour,
  }));
}

/** The store fields the card reads, declared structurally so this module stays free of the client. */
export type RaceCardSource = {
  readonly members: readonly Member[];
  readonly you: number | null;
  readonly desks: Snapshot["desks"];
  readonly ranks: Snapshot["ranks"];
  readonly race: { readonly text: string } | null;
};

/** The lane label of a server status: `expired` (the timer ran out) shows none, like typing. */
const laneStatus = (code: number): LaneStatus => {
  const status = PLAYER_STATUSES[code];
  return (LANE_STATUSES as readonly string[]).includes(status ?? "")
    ? (status as LaneStatus)
    : "typing";
};

type Memo = Omit<RaceCardSource, "desks"> & { view: RaceCardView };
const memo = new WeakMap<object, Memo>();

function viewFrom(source: RaceCardSource): RaceCardView {
  const { members, you, desks, ranks, race } = source;
  if (!race || desks.length === 0) {
    return {
      field: members.map((m) => ({
        desk: m.desk,
        progress: 0,
        you: m.desk === you,
        ink: rivalIdentity(m, you).colour,
      })),
      lanes: [],
    };
  }
  const field = selectField(desks, charsOf(normalizeTypeable(race.text)).length, you, members);
  return { field, lanes: projectLanes(source, field, selectLanes(desks, ranks, you)) };
}

/**
 * The lanes of `slots`, joined with the members (names, identity: `rivalIdentity`, #565) and the snapshot
 * entries (cursor, status) and the field's progress, by desk. `field` is `selectField` of the same
 * snapshot. Pure.
 */
export function projectLanes(
  { members, you, desks }: Pick<RaceCardSource, "members" | "you" | "desks">,
  field: readonly FieldTick[],
  slots: readonly LaneSlot[],
): Lane[] {
  const roster = new Map(members.map((m) => [m.desk, m]));
  const entries = new Map(desks.map((d, i) => [d[0], { entry: d, tick: field[i]! }]));
  return slots.map(({ desk, rank }): Lane => {
    const { entry, tick } = entries.get(desk)!;
    const { colour, shape } = identityOfDesk(desk, roster, you);
    return {
      desk,
      name: roster.get(desk)?.name ?? "",
      cursor: entry[1],
      progress: tick.progress,
      rank,
      status: laneStatus(entry[4]),
      marker: { shape, colour },
      you: desk === you,
    };
  });
}

/**
 * The race card's view of the store (#564 C3): the members (names, desks) joined with the last snapshot
 * by desk, you marked, the lanes selected by `selectLanes` in the server's rank order. Before the race or
 * its first snapshot every member sits at the start and there are no lanes (ranks exist once it runs).
 * Memoised per snapshot (its `desks` array) and roster, you and race: one object per snapshot, the same
 * on every re-read, so a keystroke re-renders no card.
 */
export function raceCardViewFrom(source: RaceCardSource): RaceCardView {
  const { members, you, desks, ranks, race } = source;
  const hit = memo.get(desks);
  if (
    hit &&
    hit.members === members &&
    hit.you === you &&
    hit.ranks === ranks &&
    hit.race === race
  ) {
    return hit.view;
  }
  const view = viewFrom(source);
  memo.set(desks, { members, you, ranks, race, view });
  return view;
}

// Fixtures: static specimen data for /design#race-hud and the component tests (not a selection rule).

/** Bare guest names (bible 2: `<Animal>-<3 digits>`, the honorific is UI copy). */
const ANIMALS = ["Sparrow", "Badger", "Heron", "Marmot", "Lynx", "Otter", "Crow", "Hedgehog"];

type Seat = { desk: number; progress: number; status?: LaneStatus };

/** A specimen desk's marker: the allocator's identity (#156), as a live room would hand it. */
const markerOf = (desk: number, youDesk: number): Lane["marker"] => {
  const { colour, shape } = rivalIdentity({ desk, ...deskIdentity(desk) }, youDesk);
  return { colour, shape };
};

/** Ranks the seats by progress (finished first), names them and gives them their desk's identity. */
function lanesOf(seats: Seat[], youDesk: number): Lane[] {
  return [...seats]
    .sort((a, b) => b.progress - a.progress || a.desk - b.desk)
    .map((s, i) => ({
      desk: s.desk,
      name: `${ANIMALS[(s.desk - 1) % ANIMALS.length]}-${String(100 + ((s.desk * 137) % 900))}`,
      // a specimen text of 100 characters
      cursor: Math.round(s.progress * 100),
      progress: s.progress,
      rank: i + 1,
      status: s.status ?? (s.progress >= 1 ? "finished" : "typing"),
      marker: markerOf(s.desk, youDesk),
      you: s.desk === youDesk,
    }));
}

/** The specimen's view; its lanes are chosen by `selectLanes`, the one selection rule. */
function viewOf(seats: Seat[], youDesk: number): RaceCardView {
  const all = lanesOf(seats, youDesk);
  const shown = new Set(
    selectLanes(
      seats.map((s) => [s.desk] as const),
      all.map((l) => l.desk),
      youDesk,
    ).map((l) => l.desk),
  );
  return {
    field: seats.map((s) => ({
      desk: s.desk,
      progress: s.progress,
      you: s.desk === youDesk,
      ink: markerOf(s.desk, youDesk).colour,
    })),
    lanes: all.filter((l) => shown.has(l.desk)),
  };
}

const SIX = [0.82, 0.64, 0.57, 0.41, 0.33, 0.12];
/** Six players, you at desk 5 with the progress of `place` (1-based) in the race. */
const six = (place: number) =>
  viewOf(
    [1, 2, 3, 4, 5, 6].map((desk) => {
      // desk 5 takes the progress of the requested place; the others fill the remaining places in order
      const others = SIX.filter((_, i) => i !== place - 1);
      return {
        desk,
        progress: desk === 5 ? SIX[place - 1]! : others[desk < 5 ? desk - 1 : desk - 2]!,
      };
    }),
    5,
  );

/** Thirty players, you at desk 17 in 13th place: the field line holds all thirty ticks, the lanes the
 * top 3, the two just ahead of you, you, and the two just behind (spec 6.2). */
const THIRTY: Seat[] = Array.from({ length: 30 }, (_, i) => {
  const desk = i + 1;
  // a spread field (13 is coprime with 30: thirty distinct steps); desk 17 lands 13th, desk 9 has finished
  const progress = desk === 9 ? 1 : Math.round((0.94 - ((desk * 13) % 30) * 0.03) * 100) / 100;
  return { desk, progress };
});
const thirty = (): RaceCardView => viewOf(THIRTY, 17);

/** The race card states of `/design#race-hud` and the component tests. */
export const raceCardViewFixtures = {
  "six-leading": six(1),
  "six-mid-field": six(4),
  "six-last": six(6),
  // one lane per status: a finished copy, a cut line, a kicked and an abandoned typist
  "six-statuses": viewOf(
    [
      { desk: 1, progress: 1 },
      { desk: 2, progress: 0.71, status: "line-cut" },
      { desk: 3, progress: 0.58 },
      { desk: 4, progress: 0.36, status: "asleep" },
      { desk: 5, progress: 0.52 },
      { desk: 6, progress: 0.18, status: "abandoned" },
    ],
    5,
  ),
  "thirty-mid-field": thirty(),
} satisfies Record<string, RaceCardView>;

export type RaceCardViewFixture = keyof typeof raceCardViewFixtures;
