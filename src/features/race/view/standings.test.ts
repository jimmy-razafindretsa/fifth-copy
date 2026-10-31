import { describe, expect, it } from "vitest";
import { PLAYER_STATUS_CODES, type Member, type RankingEntry } from "@fifth-copy/protocol";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { finalRows, liveRows, selectStandings } from "./standings";

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
