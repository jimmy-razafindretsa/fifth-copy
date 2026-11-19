import { describe, expect, it } from "vitest";
import { PLAYER_STATUS_CODES, type Member, type RankingEntry } from "@fifth-copy/protocol";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { finalRows, liveRows, selectStandings, TOP_TEN, topTenRows } from "./standings";

// #240 C2 and C3 at unit level: the finished view's rows. Live: every desk by the server's rank (no
// 8-lane window), progress from the engine; final: `ended.ranking` as sent, WPM rounded, TIMED OUT for a
// desk the timer stopped.

const member = (desk: number): Member => ({
  desk,
  name: `Lynx-${100 + desk}`,
  isHost: desk === 1,
  isBot: false,
  color: desk - 1,
  marker: "circle",
  avatar: null,
});
const { typing, finished } = PLAYER_STATUS_CODES;
const TEXT = "abcdefghij"; // 10 characters

function source(n: number, ranks: number[], you = 2) {
  const members = Array.from({ length: n }, (_, i) => member(i + 1));
  const desks = members.map(
    (m) =>
      [
        m.desk,
        m.desk === you ? 10 : m.desk,
        m.desk,
        0,
        m.desk === you ? finished : typing,
        m.desk,
      ] as [number, number, number, number, number, number],
  );
  return { members, you, desks, ranks, race: { text: TEXT } };
}

describe("selectStandings (#240 C2)", () => {
  it("lists every desk in the server's rank order, above the race card's 8-lane window", () => {
    const ranks = [2, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 1];
    const lanes = selectStandings(source(12, ranks));
    expect(lanes.map((l) => l.desk)).toEqual(ranks);
    expect(lanes.map((l) => l.rank)).toEqual(ranks.map((_, i) => i + 1));
    expect(lanes[0]).toMatchObject({ desk: 2, you: true, status: "finished", progress: 1 });
    expect(lanes[1]).toMatchObject({ desk: 12, name: "Lynx-112", progress: 1, status: "typing" });
    expect(lanes.at(-1)).toMatchObject({ desk: 1, progress: 0.1 });
  });

  it("is empty before the race or its first snapshot, and memoised per snapshot", () => {
    expect(selectStandings({ ...source(2, []), desks: [] })).toEqual([]);
    expect(selectStandings({ ...source(2, []), race: null })).toEqual([]);
    const s = source(3, [2, 3, 1]);
    expect(selectStandings(s)).toBe(selectStandings({ ...s }));
    expect(selectStandings(s)).not.toBe(selectStandings({ ...s, ranks: [3, 2, 1] }));
  });
});

describe("liveRows / finalRows (#240 C2 C3)", () => {
  it("live rows: rank, desk, name, progress in percent and the lane status word", () => {
    const rows = liveRows(selectStandings(source(2, [2, 1])), en.race.finish);
    expect(rows).toEqual([
      { place: 1, desk: 2, name: "Lynx-102", you: true, value: "100\u00a0%", status: "FILED" },
      { place: 2, desk: 1, name: "Lynx-101", you: false, value: "10\u00a0%", status: null },
    ]);
    expect(liveRows(selectStandings(source(2, [2, 1])), fr.race.finish)[0]!.status).toBe("CLASSÉ");
  });

  const entry = (over: Partial<RankingEntry>): RankingEntry => ({
    place: 1,
    desk: 1,
    name: "Lynx-101",
    isBot: false,
    status: "finished",
    wpm: 52.4,
    rawWpm: 55,
    accuracy: 0.97,
    progress: 1,
    finishedAt: 20_000,
    ...over,
  });

  it("final rows: the ranking as sent, WPM rounded, TIMED OUT for a desk the timer stopped", () => {
    const ranking = [
      entry({ desk: 2, name: "Otter-202", wpm: 71.6 }),
      entry({ place: 2, desk: 1, status: "typing", wpm: 3.2, progress: 0.3, finishedAt: null }),
    ];
    expect(finalRows(ranking, "timer", 2, en.race.finish)).toEqual([
      { place: 1, desk: 2, name: "Otter-202", you: true, value: "72 WPM", status: "FILED" },
      { place: 2, desk: 1, name: "Lynx-101", you: false, value: "3 WPM", status: "TIMED OUT" },
    ]);
    expect(finalRows(ranking, "timer", 2, fr.race.finish).map((r) => r.status)).toEqual([
      "CLASSÉ",
      "TEMPS ÉCOULÉ",
    ]);
    // after an all-finished end a typing desk reads no status
    expect(finalRows(ranking, "all-finished", 2, en.race.finish)[1]!.status).toBeNull();
  });

  it("a race that ended with no finisher (every desk asleep) still lists its desks", () => {
    const rows = finalRows(
      [entry({ status: "asleep", wpm: 0 }), entry({ place: 2, desk: 2, status: "asleep", wpm: 0 })],
      "all-finished",
      2,
      en.race.finish,
    );
    expect(rows.map((r) => [r.place, r.status, r.value])).toEqual([
      [1, "ASLEEP AT DESK", "0 WPM"],
      [2, "ASLEEP AT DESK", "0 WPM"],
    ]);
  });
});

describe("topTenRows (#999 C3)", () => {
  const thirty = (ranks: number[]) => {
    const s = source(30, ranks, 7);
    return { members: s.members, desks: s.desks, ranks: s.ranks, race: s.race, ending: null };
  };

  it("a 30-desk room shows exactly 10 rows, in the server's rank order, with no you", () => {
    const ranks = Array.from({ length: 30 }, (_, i) => 30 - i);
    const rows = topTenRows(thirty(ranks), en.race.finish);
    expect(TOP_TEN).toBe(10);
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.desk)).toEqual(ranks.slice(0, 10));
    expect(rows.map((r) => r.place)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // every desk in its rival identity: never the `you` ink, even for the desk the source calls yours
    expect(rows.every((r) => r.marker.colour !== "you")).toBe(true);
    expect(rows.every((r) => !("you" in r))).toBe(true);
    expect(rows[0]).toMatchObject({ desk: 30, name: "Lynx-130", marker: { colour: "rival-0" } });
    expect(rows[0]!.marker.shape).toBe("circle");
  });

  it("the desk the source holds as yours (the host's projector tab) is a rival like any other", () => {
    const s = source(12, [7, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12], 7);
    const rows = topTenRows({ ...s, ending: null }, en.race.finish);
    expect(rows[0]).toMatchObject({ desk: 7, place: 1, value: "100\u00a0%", status: "FILED" });
    expect(rows[0]!.marker.colour).toBe("rival-6");
  });

  it("live: the figure is the typed share, the status word when the desk is not typing", () => {
    const rows = topTenRows({ ...source(2, [2, 1]), ending: null }, fr.race.finish);
    expect(rows.map((r) => [r.place, r.desk, r.value, r.status])).toEqual([
      [1, 2, "100\u00a0%", "CLASSÉ"],
      [2, 1, "10\u00a0%", null],
    ]);
  });

  it("before the first snapshot: the roster by desk, no place, no figure", () => {
    const s = source(12, []);
    const rows = topTenRows({ ...s, desks: [], ending: null }, en.race.finish);
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.desk)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rows.every((r) => r.place === null && r.value === null && r.status === null)).toBe(true);
    expect(topTenRows({ ...s, members: [], desks: [], ending: null }, en.race.finish)).toEqual([]);
  });

  it("after the end: the server's final ranking as sent, cut to 10, WPM rounded", () => {
    const ranking: RankingEntry[] = Array.from({ length: 12 }, (_, i) => ({
      place: i + 1,
      desk: 12 - i,
      name: `Lynx-${112 - i}`,
      isBot: false,
      status: "finished",
      wpm: 60.4 - i,
      rawWpm: 62,
      accuracy: 1,
      progress: 1,
      finishedAt: 20_000 + i,
    }));
    const s = source(12, [1, 2, 3]);
    const rows = topTenRows({ ...s, ending: { reason: "all-finished", ranking } }, en.race.finish);
    expect(rows).toHaveLength(10);
    // bible 14.3: `52 WPM` once the race is over, never the status word
    expect(rows[0]).toMatchObject({ place: 1, desk: 12, value: "60 WPM", status: null });
    expect(rows.every((r) => r.status === null)).toBe(true);
    expect(rows[9]).toMatchObject({ place: 10, desk: 3, value: "51 WPM" });
    // an end with no ranking (a reload found the room ended) falls back to the live order
    const live = topTenRows({ ...s, ending: { reason: "timer", ranking: [] } }, en.race.finish);
    expect(live.map((r) => r.desk)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
