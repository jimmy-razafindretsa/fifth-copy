/**
 * The race card's view model (#560, ADR 0013, design bible 7.4a): "where am I in the race" as data. It is
 * what `RaceCard` renders and nothing else: ranks, progress and statuses arrive from the race server
 * through the store (#564 selects the lanes and projects the snapshot, #565 the per-rival inks); no race
 * rule lives here or in the component (ADR 0007).
 */

/** The four colour-blind-safe rival marker shapes (spec 6.2, R80), drawn as inline SVG. */
export const MARKER_SHAPES = ["circle", "square", "triangle", "diamond"] as const;
export type MarkerShape = (typeof MARKER_SHAPES)[number];

/**
 * A rival's marker ink, as a colour role name (never a value). `rival` is ribbon-violet (bible 3); the
 * per-rival muted inks of #565 extend this union and add one CSS mapping each in race-card.module.css.
 */
export type MarkerInk = "rival";

/** A lane's status label; `typing` shows none (spec 4.4, 4.5, 7.4; the lane label, bible 7.4a). */
export const LANE_STATUSES = ["typing", "line-cut", "asleep", "abandoned", "finished"] as const;
export type LaneStatus = (typeof LANE_STATUSES)[number];

/** One tick of the full-field line: every player of the race, `progress` 0..1 (1 = finished). */
export type FieldTick = { desk: number; progress: number; you: boolean };

/** One lane: a selected player with its name, rank (1 = leading), marker and status. */
export type Lane = {
  desk: number;
  name: string;
  progress: number;
  rank: number;
  status: LaneStatus;
  marker: { shape: MarkerShape; colour: MarkerInk };
  you: boolean;
};

/** `field`: one entry per player, any order. `lanes`: the selected players, in rank order. */
export type RaceCardView = { field: FieldTick[]; lanes: Lane[] };

// Fixtures: static specimen data for /design#race-hud and the component tests (not a selection rule).

/** Bare guest names (bible 2: `<Animal>-<3 digits>`, the honorific is UI copy). */
const ANIMALS = ["Sparrow", "Badger", "Heron", "Marmot", "Lynx", "Otter", "Crow", "Hedgehog"];

type Seat = { desk: number; progress: number; status?: LaneStatus };

/** Ranks the seats by progress (finished first), names them and gives them a varied marker shape. */
function lanesOf(seats: Seat[], youDesk: number): Lane[] {
  return [...seats]
    .sort((a, b) => b.progress - a.progress || a.desk - b.desk)
    .map((s, i) => ({
      desk: s.desk,
      name: `${ANIMALS[(s.desk - 1) % ANIMALS.length]}-${String(100 + ((s.desk * 137) % 900))}`,
      progress: s.progress,
      rank: i + 1,
      status: s.status ?? (s.progress >= 1 ? "finished" : "typing"),
      marker: { shape: MARKER_SHAPES[(s.desk - 1) % MARKER_SHAPES.length]!, colour: "rival" },
      you: s.desk === youDesk,
    }));
}

function viewOf(seats: Seat[], youDesk: number, keep?: (lane: Lane) => boolean): RaceCardView {
  const lanes = lanesOf(seats, youDesk);
  return {
    field: seats.map((s) => ({ desk: s.desk, progress: s.progress, you: s.desk === youDesk })),
    lanes: keep ? lanes.filter(keep) : lanes,
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
const thirty = (): RaceCardView => {
  const all = lanesOf(THIRTY, 17);
  const you = all.find((l) => l.you)!.rank;
  return viewOf(THIRTY, 17, (l) => l.rank <= 3 || Math.abs(l.rank - you) <= 2);
};

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
