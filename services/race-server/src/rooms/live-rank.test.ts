import type { Redis } from "ioredis";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  PLAYER_STATUS_CODES,
  PROTOCOL_VERSION,
  snapshotSchema,
  type RaceInfo,
} from "@fifth-copy/protocol";
import { startedRace, typeKeys, until, type Booted } from "../testing/harness";
import { createDesksState } from "./desks-state";
import { ingest } from "./ingest";
import { collectSnapshot, diffRanks, raceElapsed } from "./live-rank";

// #173: live ranking (engine `rank` through `rankingFor`) and the overtake diff (C4).

describe("diffRanks (C4)", () => {
  it("desk 2 passing desk 1: one overtake pair and a new leader", () => {
    expect(diffRanks([1, 2, 3], [2, 1, 3])).toEqual({
      overtakes: [{ desk: 2, passed: 1 }],
      newLeader: 2,
    });
  });

  it("no rank change: no event", () => {
    expect(diffRanks([1, 2, 3], [1, 2, 3])).toEqual({ overtakes: [], newLeader: null });
  });

  it("passing two desks in one tick: two overtakes for the passer", () => {
    expect(diffRanks([1, 2, 3], [3, 1, 2])).toEqual({
      overtakes: [
        { desk: 3, passed: 1 },
        { desk: 3, passed: 2 },
      ],
      newLeader: 3,
    });
  });

  it("a pass below the lead keeps the leader; unknown desks are ignored", () => {
    expect(diffRanks([1, 2, 3, 4], [1, 4, 2, 3])).toEqual({
      overtakes: [
        { desk: 4, passed: 2 },
        { desk: 4, passed: 3 },
      ],
      newLeader: null,
    });
    expect(diffRanks([1, 2], [3, 2, 1])).toEqual({
      overtakes: [{ desk: 2, passed: 1 }],
      newLeader: 3,
    });
  });
});

describe("collectSnapshot", () => {
  const race: RaceInfo = {
    raceId: "6f1c2a4e-8b9d-4c3e-9f0a-1b2c3d4e5f60",
    text: "bonjour",
    language: "fr",
    wordCount: 1,
    t0: 1_000,
    timerS: null,
  };
  const desks = [1, 2, 3].map((desk) => ({ desk, userId: `u${desk}`, name: "D", isBot: false }));

  it("lists every desk once as integer tuples and ranks them by progress", () => {
    const state = createDesksState({ redis: {} as Redis });
    const rt = state.open("lob", { race, settings: DEFAULT_RACE_SETTINGS, desks });
    ingest(
      rt,
      3,
      [..."bon"].map((key, i) => ({ t: 100 + i, key })),
      1_200,
    );
    ingest(rt, 2, [{ t: 100, key: "x" }], 1_200);
    const { snapshot, ranking } = collectSnapshot(rt, raceElapsed(rt, 1_300));
    expect(snapshotSchema.parse(snapshot)).toEqual({
      v: PROTOCOL_VERSION,
      t: 300,
      desks: [
        [1, 0, 0, 0, PLAYER_STATUS_CODES.typing],
        [2, 1, 0, 1, PLAYER_STATUS_CODES.typing],
        [3, 3, 3, 0, PLAYER_STATUS_CODES.typing],
      ],
      ranks: [3, 2, 1],
    });
    expect(ranking.map((e) => e.place)).toEqual([1, 2, 3]);
  });
});

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.stop();
  booted = undefined;
});

describe("overtake events over the wire (C4)", () => {
  it("desk 2 passes desk 1: overtake to 2, passed to 1, new-leader to the room, once", async () => {
    const r = await startedRace(process.env.REDIS_URL, { players: 3, text: "bonjour madame" });
    booted = r.booted;
    const [one, two, three] = r.racers;
    const tick = async () => {
      r.booted.clock.advance(100);
      await new Promise((res) => setTimeout(res, 30));
    };
    typeKeys(one!.client, "bo", 20, 10);
    await until(() => r.booted.server.desks.states(r.lobby).get(1)?.cursor === 2, 2_000, "desk 1");
    await tick(); // ranks unchanged from GO ([1, 2, 3]): no event
    typeKeys(two!.client, "bonj", 120, 10);
    await until(() => r.booted.server.desks.states(r.lobby).get(2)?.cursor === 4, 2_000, "desk 2");
    await tick();
    await until(
      () => three!.seen.events.some((e) => e.kind === "new-leader" && e.desk === 2),
      2_000,
      "new leader 2",
    );
    await tick();
    await tick();

    const kinds = (seen: typeof one.seen, kind: string) =>
      seen.events.filter((e) => e.kind === kind);
    expect(kinds(two!.seen, "overtake")).toEqual([
      { v: PROTOCOL_VERSION, kind: "overtake", desk: 2, passed: 1 },
    ]);
    expect(kinds(one!.seen, "passed")).toEqual([
      { v: PROTOCOL_VERSION, kind: "passed", desk: 1, by: 2 },
    ]);
    expect(kinds(three!.seen, "new-leader")).toEqual([
      { v: PROTOCOL_VERSION, kind: "new-leader", desk: 2 },
    ]);
    expect(kinds(three!.seen, "overtake")).toEqual([]);
    expect(kinds(three!.seen, "passed")).toEqual([]);
    const last = snapshotSchema.parse(three!.seen.snapshots.at(-1));
    expect(last.ranks).toEqual([2, 1, 3]);
  });
});
