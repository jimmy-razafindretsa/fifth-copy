import { initialState, type PlayerState } from "@fifth-copy/engine";
import { rankingEntrySchema } from "@fifth-copy/protocol";
import { describe, expect, it } from "vitest";
import type { RaceDesk } from "./registry";
import { rankingFor } from "./ranking";

const desk = (n: number, isBot = false): RaceDesk => ({
  desk: n,
  userId: isBot ? null : `usr_${n}`,
  name: `Clerk ${n}`,
  isBot,
});
const state = (patch: Partial<PlayerState>): PlayerState => ({ ...initialState(), ...patch });

describe("rankingFor (engine rank -> RankingEntry)", () => {
  it("lists every desk once with places 1..N, untouched desks by desk with wpm 0", () => {
    const ranking = rankingFor([desk(3), desk(1), desk(2, true)], new Map(), 100, 60_000);
    expect(ranking.map((r) => [r.place, r.desk])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    for (const entry of ranking) {
      expect(rankingEntrySchema.parse(entry)).toEqual(entry);
      expect(entry).toMatchObject({
        status: "typing",
        wpm: 0,
        rawWpm: 0,
        accuracy: 1,
        progress: 0,
      });
    }
    expect(ranking[1]!.isBot).toBe(true);
  });

  it("orders through the engine: finishers by time, then progress; scores at the right elapsed", () => {
    const states = new Map<number, PlayerState>([
      [1, state({ cursor: 50, correct: 50, total: 50, lastT: 30_000 })],
      [2, state({ cursor: 100, correct: 100, total: 100, status: "finished", finishedAt: 30_000 })],
      [3, state({ cursor: 80, correct: 80, total: 80, status: "asleep", lastT: 30_000 })],
    ]);
    const ranking = rankingFor([desk(1), desk(2), desk(3)], states, 100, 60_000);
    expect(ranking.map((r) => r.desk)).toEqual([2, 3, 1]);
    // finished: 100 chars / 5 over 0.5 min; asleep: at its last key; typing: at race end.
    expect(ranking.map((r) => r.wpm)).toEqual([40, 32, 10]);
    expect(ranking[0]).toMatchObject({ progress: 1, finishedAt: 30_000, status: "finished" });
  });
});
