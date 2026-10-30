import { describe, expect, it } from "vitest";
import { charsOf, normalizeTypeable, progress } from "@fifth-copy/engine";
import {
  DEFAULT_RACE_SETTINGS,
  PLAYER_STATUS_CODES,
  PLAYER_STATUSES,
  PROTOCOL_VERSION,
  roomCodeSchema,
  type Member,
  type Snapshot,
  type Welcome,
} from "@fifth-copy/protocol";
import {
  createRaceStore,
  initialRaceState,
  reduceRace,
  selectRaceCardView,
  type RaceEvent,
  type RaceState,
} from "../client/store";
import {
  raceCardViewFixtures,
  raceCardViewFrom,
  selectField,
  selectLanes,
  type RaceCardSource,
} from "./race-card-view";

// Contract of #564 C1, C2, C3: the race card's lane selection, its full-field projection and the join
// of the store's members with the 10 Hz snapshot (ADR 0006: ranks and cursors are the server's; ADR
// 0007: progress is the engine's own `progress`).

type Desk = Snapshot["desks"][number];
const { typing, finished, asleep, abandoned, expired } = PLAYER_STATUS_CODES;
const desk = (n: number, cursor = 0, code: number = typing): Desk => [
  n,
  cursor,
  cursor,
  0,
  code,
  cursor,
];

/** `n` desks in desk order, ranked by a fixed permutation (rank never equals desk order). */
function field(n: number) {
  const desks = Array.from({ length: n }, (_, i) => desk(i + 1));
  // 7 is coprime with 6, 8, 9, 12 and 30: a permutation of 1..n
  const ranks = Array.from({ length: n }, (_, i) => ((i * 7) % n) + 1);
  return { desks, ranks };
}

/** Deep-freezes a value so a selector that mutates its input throws. */
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) freeze(v);
  }
  return value;
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("selectLanes (#564 C1)", () => {
  // [players, your rank, the ranks shown]
  const TABLE: [number, number, number[]][] = [
    [6, 1, range(1, 6)],
    [6, 4, range(1, 6)],
    [6, 6, range(1, 6)],
    [8, 1, range(1, 8)],
    [8, 5, range(1, 8)],
    [8, 8, range(1, 8)],
    [9, 1, [1, 2, 3]],
    [9, 4, range(1, 6)],
    [9, 5, range(1, 7)],
    [9, 9, [1, 2, 3, 7, 8, 9]],
    [12, 1, [1, 2, 3]],
    [12, 3, range(1, 5)],
    [12, 4, range(1, 6)],
    [12, 5, range(1, 7)],
    [12, 6, range(1, 8)],
    [12, 11, [1, 2, 3, 9, 10, 11, 12]],
    [12, 12, [1, 2, 3, 10, 11, 12]],
    [30, 1, [1, 2, 3]],
    [30, 2, range(1, 4)],
    [30, 4, range(1, 6)],
    [30, 15, [1, 2, 3, 13, 14, 15, 16, 17]],
    [30, 30, [1, 2, 3, 28, 29, 30]],
  ];

  it.each(TABLE)("%i players, you ranked %i: ranks %j", (n, place, shown) => {
    const { desks, ranks } = freeze(field(n));
    const you = ranks[place - 1]!;
    const lanes = selectLanes(desks, ranks, you);
    expect(lanes.map((l) => l.rank)).toEqual(shown);
    // ordered by rank, each lane the desk of that rank, you always in
    expect(lanes.map((l) => l.desk)).toEqual(shown.map((r) => ranks[r - 1]));
    expect(lanes.some((l) => l.desk === you)).toBe(true);
  });

  it("all desks when there are 8 or fewer; above, at most 8, and at most 7 when you are top 3", () => {
    for (const n of [1, 2, 6, 8, 9, 12, 30]) {
      const { desks, ranks } = field(n);
      for (let place = 1; place <= n; place++) {
        const lanes = selectLanes(desks, ranks, ranks[place - 1]!);
        if (n <= 8) expect(lanes, `${n} @${place}`).toHaveLength(n);
        else expect(lanes.length, `${n} @${place}`).toBeLessThanOrEqual(8);
        if (n > 8 && place <= 3) expect(lanes.length, `${n} @${place}`).toBeLessThanOrEqual(7);
        const order = lanes.map((l) => l.rank);
        expect(order, "rank order").toEqual([...order].sort((a, b) => a - b));
        expect(new Set(lanes.map((l) => l.desk)).size, "deduplicated").toBe(lanes.length);
      }
    }
  });

  it("is pure: the same answer twice, the inputs untouched", () => {
    const { desks, ranks } = freeze(field(30));
    expect(selectLanes(desks, ranks, 9)).toEqual(selectLanes(desks, ranks, 9));
  });

  it("follows the ranks, not the desks: a repeated or unknown desk in ranks is dropped, a missing one goes last", () => {
    const desks = [desk(1), desk(2), desk(3)];
    expect(selectLanes(desks, [3, 3, 9, 1], 1)).toEqual([
      { desk: 3, rank: 1 },
      { desk: 1, rank: 2 },
      { desk: 2, rank: 3 },
    ]);
  });

  it("without a desk (a spectator) above 8 players: the top 3 only", () => {
    const { desks, ranks } = field(12);
    expect(selectLanes(desks, ranks, null).map((l) => l.rank)).toEqual([1, 2, 3]);
  });
});

describe("selectField (#564 C2)", () => {
  it("maps every desk to the engine's progress of its snapshot entry, in 0..1", () => {
    const desks = freeze([
      desk(1, 5),
      desk(2, 0),
      desk(3, 9, finished),
      desk(4, 3, asleep),
      desk(5, 14),
      desk(6, 2, abandoned),
    ]);
    const ticks = selectField(desks, 10);
    expect(ticks.map((t) => t.desk)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ticks.map((t) => t.progress)).toEqual([0.5, 0, 1, 0.3, 1, 0.2]);
    ticks.forEach((t, i) => {
      const [, cursor, , , code] = desks[i]!;
      expect(t.progress).toBe(progress({ cursor, status: PLAYER_STATUSES[code]! }, 10));
    });
  });

  it("finished is 1 whatever the cursor; an empty text is 0; a cursor past the base length clamps to 1", () => {
    expect(selectField([desk(1, 3, finished)], 40)[0]!.progress).toBe(1);
    expect(selectField([desk(1, 3)], 0)[0]!.progress).toBe(0);
    // ADR 0016: an Extra Paperwork hit lengthens a rival's text; the snapshot only has its cursor
    expect(selectField([desk(1, 47)], 40)[0]!.progress).toBe(1);
  });

  it("marks your tick, the only one", () => {
    const ticks = selectField([desk(1), desk(2), desk(3)], 10, 2);
    expect(ticks.map((t) => t.you)).toEqual([false, true, false]);
    expect(selectField([desk(1)], 10).every((t) => !t.you)).toBe(true);
  });
});

const member = (n: number, name: string): Member => ({
  desk: n,
  name,
  isHost: n === 1,
  isBot: false,
  color: (n - 1) % 12,
  marker: (["circle", "square", "triangle", "diamond"] as const)[(n - 1) % 4]!,
});

const TEXT = "Le reçu des formulaires";
const LENGTH = charsOf(normalizeTypeable(TEXT)).length;
const RACE = {
  raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
  text: TEXT,
  language: "fr" as const,
  wordCount: 3,
  t0: 1_767_225_603_000,
  timerS: DEFAULT_RACE_SETTINGS.timerS,
};

describe("raceCardViewFrom (#564 C3)", () => {
  const members = [member(3, "Heron-411"), member(1, "Sparrow-137"), member(5, "Lynx-785")];
  const source = (over: Partial<RaceCardSource> = {}): RaceCardSource =>
    freeze({
      members,
      you: 5,
      desks: [desk(1, 4), desk(3, 23, finished), desk(5, 11, asleep)],
      ranks: [3, 5, 1],
      race: RACE,
      ...over,
    });

  it("joins the members with the snapshot by desk, marks you and ranks the lanes by the server's order", () => {
    const view = raceCardViewFrom(source());
    expect(view.field).toEqual([
      { desk: 1, progress: 4 / LENGTH, you: false },
      { desk: 3, progress: 1, you: false },
      { desk: 5, progress: 11 / LENGTH, you: true },
    ]);
    expect(view.lanes).toEqual([
      {
        desk: 3,
        name: "Heron-411",
        cursor: 23,
        progress: 1,
        rank: 1,
        status: "finished",
        marker: { shape: "circle", colour: "rival" },
        you: false,
      },
      {
        desk: 5,
        name: "Lynx-785",
        cursor: 11,
        progress: 11 / LENGTH,
        rank: 2,
        status: "asleep",
        marker: { shape: "circle", colour: "rival" },
        you: true,
      },
      {
        desk: 1,
        name: "Sparrow-137",
        cursor: 4,
        progress: 4 / LENGTH,
        rank: 3,
        status: "typing",
        marker: { shape: "circle", colour: "rival" },
        you: false,
      },
    ]);
  });

  it("uses ribbon-violet circles as every lane's default marker (the per-rival shapes and inks are #565)", () => {
    const desks = Array.from({ length: 12 }, (_, i) => desk(i + 1, i));
    const many = Array.from({ length: 12 }, (_, i) => member(i + 1, `Crow-${100 + i}`));
    const view = raceCardViewFrom(
      source({ members: many, desks, ranks: desks.map((d) => d[0]).reverse(), you: 7 }),
    );
    expect(view.lanes.length).toBeGreaterThan(0);
    for (const lane of view.lanes)
      expect(lane.marker).toEqual({ shape: "circle", colour: "rival" });
  });

  it("the statuses map from the snapshot code; an expired desk shows no label", () => {
    const desks = [
      desk(1, 2, PLAYER_STATUS_CODES["line-cut"]),
      desk(3, 1, abandoned),
      desk(5, 3, expired),
    ];
    const view = raceCardViewFrom(source({ desks, ranks: [5, 1, 3] }));
    expect(view.lanes.map((l) => [l.desk, l.status])).toEqual([
      [5, "typing"],
      [1, "line-cut"],
      [3, "abandoned"],
    ]);
  });

  it("before the race (or before its first snapshot): every member at the start, yours marked, no lanes", () => {
    const empty = {
      field: members.map((m) => ({ desk: m.desk, progress: 0, you: m.desk === 5 })),
      lanes: [],
    };
    expect(raceCardViewFrom(source({ race: null, desks: [], ranks: [] }))).toEqual(empty);
    expect(raceCardViewFrom(source({ desks: [], ranks: [] }))).toEqual(empty);
    expect(raceCardViewFrom(source({ members: [], you: null, race: null, desks: [] }))).toEqual({
      field: [],
      lanes: [],
    });
  });

  it("is memoised per snapshot: one recomputation per snapshot in a 10 Hz replay", () => {
    const welcome: Welcome = {
      v: PROTOCOL_VERSION,
      role: "player",
      you: 5,
      room: { code: roomCodeSchema.parse("KGB-4821"), phase: "waiting" },
      members,
      settings: DEFAULT_RACE_SETTINGS,
      race: null,
      state: null,
      overlay: null,
      resumeKey: null,
      serverNow: 1_767_225_600_000,
    };
    const start: RaceEvent[] = [
      { type: "welcome", payload: welcome },
      { type: "countdown", payload: { v: PROTOCOL_VERSION, race: RACE } },
      { type: "go" },
    ];
    const store = createRaceStore(start.reduce(reduceRace, initialRaceState as RaceState));
    const views = new Set<unknown>([selectRaceCardView(store.getState())]);
    let reads = 1;
    // what useSyncExternalStore does: read the selector on every store change (and again on render)
    store.subscribe(() => {
      const state = store.getState();
      views.add(selectRaceCardView(state));
      expect(selectRaceCardView(state)).toBe(selectRaceCardView(state));
      reads++;
    });
    const SNAPSHOTS = 30;
    const chars = [...TEXT];
    for (let i = 1; i <= SNAPSHOTS; i++) {
      // between two snapshots (100 ms apart) the viewer types: those changes are not the card's
      const key = chars[(i - 1) % chars.length]!;
      store.dispatch({ type: "key", keystroke: { t: i * 100 - 50, key } });
      store.dispatch({ type: "sent", count: 1 });
      store.dispatch({
        type: "snapshot",
        payload: {
          v: PROTOCOL_VERSION,
          t: i * 100,
          desks: [desk(1, i), desk(3, Math.floor(i / 2)), desk(5, Math.min(i, LENGTH - 1))],
          ranks: [1, 5, 3],
        },
      });
    }
    expect(reads).toBeGreaterThan(2 * SNAPSHOTS);
    // the before-start view, then exactly one view per snapshot
    expect(views.size).toBe(1 + SNAPSHOTS);
    expect(selectRaceCardView(store.getState())).toBe(raceCardViewFrom(store.getState()));
    // a roster change is a recomputation too (a new name), the same snapshot otherwise
    const before = selectRaceCardView(store.getState());
    store.dispatch({
      type: "roster",
      payload: { v: PROTOCOL_VERSION, members: [...members, member(7, "Otter-959")] },
    });
    expect(selectRaceCardView(store.getState())).not.toBe(before);
  });
});

describe("the fixtures select their lanes with the one rule (#564 C1)", () => {
  it("thirty-mid-field shows the top 3, the two ahead of you, you and the two behind", () => {
    const thirty = raceCardViewFixtures["thirty-mid-field"];
    expect(thirty.field).toHaveLength(30);
    expect(thirty.lanes.map((l) => l.rank)).toEqual([1, 2, 3, 11, 12, 13, 14, 15]);
    expect(thirty.lanes.find((l) => l.you)?.rank).toBe(13);
  });
});
