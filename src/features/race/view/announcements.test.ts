import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import {
  ANNOUNCE_DWELL_MS,
  ANNOUNCE_MAX_PENDING,
  PLACE_EVERY_MS,
  announcementText,
  announcementsFor,
  createAnnounceQueue,
  placeDueIn,
  type AnnounceView,
  type Announcement,
  type PlaceMemo,
} from "./announcements";

// Contract of #242 C1: the race announcer's sentences are a pure function of two views of the race
// store (and the countdown step): the countdown digits and GO, your place at most once per 5 s, the
// overtake and passed lines, your finish and the race over, each with place n of m. Announcements carry
// numbers and desk ids only, so no character of the race text can ever reach the live region.

const T = 1_767_225_600_000;
const TEXT = "zqxj vfwk plmb";

const view = (patch: Partial<AnnounceView> = {}): AnnounceView => ({
  at: T,
  phase: "running",
  step: null,
  stamp: null,
  wpm: 0,
  place: 2,
  total: 3,
  typing: true,
  over: null,
  ...patch,
});

const stamp = (id: number, kind: "overtake" | "passed" | "accepted" | "returned", other = 1) => ({
  id,
  kind,
  other,
  errors: kind === "returned" ? 2 : 0,
});

/** Runs a sequence of views through `announcementsFor`, threading the place memo, as the region does. */
function run(views: AnnounceView[]): Announcement[] {
  const said: Announcement[] = [];
  let prev: AnnounceView | null = null;
  let memo: PlaceMemo = null;
  for (const next of views) {
    const out = announcementsFor(prev, next, memo);
    said.push(...out.said);
    memo = out.memo;
    prev = next;
  }
  return said;
}

const labels = (cat: typeof en | typeof fr) => ({
  announce: cat.race.announce,
  countdown: cat.race.countdown,
  stamps: cat.race.stamps,
});

describe("#242 C1 announcementsFor", () => {
  it("says the countdown digits and GO, once each, and nothing else before GO", () => {
    const countdown: AnnounceView = view({ phase: "countdown", typing: false, place: 0 });
    const said = run([
      { ...countdown, step: 3 },
      { ...countdown, step: 3, at: T + 100 },
      { ...countdown, step: 2, at: T + 1_000 },
      { ...countdown, step: 1, at: T + 2_000 },
      view({ step: "go", at: T + 3_000 }),
    ]);
    expect(said).toEqual([
      { kind: "count", n: 3 },
      { kind: "count", n: 2 },
      { kind: "count", n: 1 },
      { kind: "go" },
    ]);
  });

  it("holds the place while the GO stamp shows, then says it once the stamp leaves", () => {
    const said = run([
      view({ step: "go", at: T }),
      view({ step: "go", at: T + 500 }),
      view({ step: null, at: T + 1_200 }),
      view({ at: T + 1_300 }),
    ]);
    expect(said).toEqual([{ kind: "go" }, { kind: "place", place: 2, total: 3 }]);
  });

  it("says a place change at most once per 5 s, then the place you hold when the window ends", () => {
    const said = run([
      view({ at: T }),
      view({ at: T + 1_000, place: 1 }),
      view({ at: T + 2_000, place: 3 }),
      view({ at: T + PLACE_EVERY_MS - 1, place: 1 }),
      view({ at: T + PLACE_EVERY_MS, place: 1 }),
      view({ at: T + PLACE_EVERY_MS + 100, place: 1 }),
    ]);
    expect(said).toEqual([
      { kind: "place", place: 2, total: 3 },
      { kind: "place", place: 1, total: 3 },
    ]);
  });

  it("placeDueIn: when a withheld change falls due (the region re-reads the store then)", () => {
    const memo = { place: 2, at: T };
    expect(placeDueIn(view({ at: T + 1_000, place: 1 }), memo)).toBe(PLACE_EVERY_MS - 1_000);
    expect(placeDueIn(view({ at: T + 1_000, place: 2 }), memo)).toBeNull();
    expect(placeDueIn(view({ at: T + 1_000, place: 1, typing: false }), memo)).toBeNull();
    expect(placeDueIn(view({ at: T + 1_000, place: 1 }), null)).toBeNull();
  });

  it("drops a change that came back before the window ended (nothing new to say)", () => {
    const said = run([
      view({ at: T }),
      view({ at: T + 1_000, place: 1 }),
      view({ at: T + 2_000, place: 2 }),
      view({ at: T + 9_000, place: 2 }),
    ]);
    expect(said).toEqual([{ kind: "place", place: 2, total: 3 }]);
  });

  it("says the overtake and passed lines per new stamp; each one counts as the place line", () => {
    const said = run([
      view({ at: T }),
      view({ at: T + 6_000, place: 1, stamp: stamp(1, "overtake", 4) }),
      view({ at: T + 6_100, place: 1, stamp: stamp(1, "overtake", 4) }),
      view({ at: T + 7_500, place: 2, stamp: stamp(2, "passed", 4) }),
      view({ at: T + 9_000, place: 2 }),
      view({ at: T + 13_000, place: 2 }),
    ]);
    expect(said).toEqual([
      { kind: "place", place: 2, total: 3 },
      { kind: "overtake", desk: 4 },
      { kind: "passed", desk: 4 },
    ]);
  });

  it("says your finish with your place, then the finish stamp's line; no place line after it", () => {
    const said = run([
      view({ at: T }),
      view({ at: T + 8_000, place: 1, typing: false, wpm: 48, stamp: stamp(3, "accepted", 2) }),
      view({ at: T + 20_000, place: 1, typing: false }),
    ]);
    expect(said).toEqual([
      { kind: "place", place: 2, total: 3 },
      { kind: "finished", place: 1, total: 3 },
      { kind: "filed", stamp: "accepted", errors: 0, wpm: 48 },
    ]);
  });

  it("says the race over once, with your final place (or none when you are not ranked)", () => {
    const ended = { phase: "ended" as const, typing: false };
    expect(
      run([
        view({ at: T, typing: false }),
        view({ ...ended, at: T + 100, over: { place: 2, total: 3 } }),
        view({ ...ended, at: T + 200, over: { place: 2, total: 3 } }),
      ]),
    ).toEqual([{ kind: "over", place: 2, total: 3 }]);
    expect(run([view({ ...ended, over: { place: 0, total: 0 } })])).toEqual([
      { kind: "over", place: 0, total: 0 },
    ]);
  });

  it("says nothing for a spectator's place (no desk) and nothing after an exit", () => {
    expect(run([view({ place: 0 }), view({ at: T + 6_000, place: 0 })])).toEqual([]);
    expect(
      run([view({ typing: false }), view({ at: T + 6_000, typing: false, place: 1 })]),
    ).toEqual([]);
  });

  it("a new countdown forgets the last race's place", () => {
    const said = run([
      view({ at: T }),
      view({ phase: "countdown", typing: false, step: 3, at: T + 1_000 }),
      view({ at: T + 5_000 }),
    ]);
    expect(said).toEqual([
      { kind: "place", place: 2, total: 3 },
      { kind: "count", n: 3 },
      { kind: "place", place: 2, total: 3 },
    ]);
  });
});

describe("#242 C1 announcementText", () => {
  const every: Announcement[] = [
    { kind: "count", n: 3 },
    { kind: "go" },
    { kind: "place", place: 3, total: 12 },
    { kind: "overtake", desk: 7 },
    { kind: "passed", desk: 7 },
    { kind: "finished", place: 2, total: 12 },
    { kind: "filed", stamp: "accepted", errors: 0, wpm: 48 },
    { kind: "filed", stamp: "returned", errors: 2, wpm: 30 },
    { kind: "over", place: 2, total: 12 },
    { kind: "over", place: 0, total: 0 },
  ];

  it("reads the bible's English lines", () => {
    expect(every.map((a) => announcementText(a, labels(en)))).toEqual([
      "3",
      "GO",
      "Place 3 of 12",
      "You passed desk 07",
      "Desk 07 passed you",
      "Finished. Place 2 of 12",
      "ACCEPTED · 48 WPM",
      "RETURNED · 2 ERRORS",
      "Race over. Place 2 of 12",
      "Race over.",
    ]);
  });

  it("reads the French catalog's lines", () => {
    expect(every.map((a) => announcementText(a, labels(fr)))).toEqual([
      "3",
      "PARTEZ",
      "Position 3 sur 12",
      "Tu as dépassé le bureau 07",
      "Le bureau 07 t'a dépassé",
      "Terminé. Position 2 sur 12",
      "ACCEPTÉ · 48 MPM",
      "RETOURNÉ · 2 FAUTES",
      "Course terminée. Position 2 sur 12",
      "Course terminée.",
    ]);
  });

  it("never reads any character of the race text (announcements hold numbers only)", () => {
    const said = run([
      view({ phase: "countdown", typing: false, step: 3 }),
      view({ step: "go", at: T + 3_000 }),
      view({ at: T + 4_300 }),
      view({ at: T + 10_000, place: 1, stamp: stamp(1, "overtake", 3) }),
      view({ at: T + 12_000, place: 1, typing: false, wpm: 40, stamp: stamp(2, "returned", 2) }),
      view({ phase: "ended", typing: false, at: T + 13_000, over: { place: 1, total: 3 } }),
    ]);
    for (const a of said) {
      const words = Object.values(a).filter((v) => typeof v === "string");
      expect(words.every((w) => w === a.kind || w === "accepted" || w === "returned")).toBe(true);
      for (const cat of [en, fr]) {
        const line = announcementText(a, labels(cat));
        for (const word of TEXT.split(" ")) expect(line).not.toContain(word);
      }
    }
    expect(said).toHaveLength(7);
  });
});

describe("#242 the announcer's pace (bounded rate)", () => {
  afterEach(() => vi.useRealTimers());

  it("shows each line for at least the dwell, in order, keeping at most a few waiting", () => {
    vi.useFakeTimers();
    const shown: string[] = [];
    const queue = createAnnounceQueue((line) => shown.push(line.text));
    queue.push(["a", "b"]);
    expect(shown).toEqual(["a"]);
    vi.advanceTimersByTime(ANNOUNCE_DWELL_MS - 1);
    expect(shown).toEqual(["a"]);
    vi.advanceTimersByTime(1);
    expect(shown).toEqual(["a", "b"]);
    // a burst past the bound keeps the newest lines
    queue.push(Array.from({ length: ANNOUNCE_MAX_PENDING + 2 }, (_, i) => `x${i}`));
    vi.advanceTimersByTime(ANNOUNCE_DWELL_MS * (ANNOUNCE_MAX_PENDING + 3));
    expect(shown.slice(2)).toEqual(
      Array.from({ length: ANNOUNCE_MAX_PENDING }, (_, i) => `x${i + 2}`),
    );
    // idle: the next line shows at once
    queue.push(["c"]);
    expect(shown.at(-1)).toBe("c");
    queue.dispose();
  });

  it("gives every line a new id, so the same sentence twice is read twice", () => {
    vi.useFakeTimers();
    const ids: number[] = [];
    const queue = createAnnounceQueue((line) => ids.push(line.id));
    queue.push(["same"]);
    vi.advanceTimersByTime(ANNOUNCE_DWELL_MS);
    queue.push(["same"]);
    expect(new Set(ids).size).toBe(2);
    queue.dispose();
  });
});
