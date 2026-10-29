import { describe, expect, it } from "vitest";
import {
  deskIdentity,
  PLAYER_STATUS_CODES,
  type Member,
  type Snapshot,
} from "@fifth-copy/protocol";
import { selectSceneView, type SceneSource } from "./scene-view";

// #563 (ADR 0017 shared core): the one value the seat scene reads, derived from the race store.

const member = (desk: number): Member => ({
  desk,
  name: `Sim-${desk}`,
  isHost: desk === 1,
  isBot: false,
  ...deskIdentity(desk),
});
const { typing, finished } = PLAYER_STATUS_CODES;
type Desk = Snapshot["desks"][number];
const entry = (desk: number, cursor: number, code: number = typing): Desk => [
  desk,
  cursor,
  cursor,
  0,
  code,
  cursor,
];

const base: SceneSource = {
  phase: "waiting",
  you: 3,
  members: [member(5), member(1), member(3)],
  desks: [],
  ranks: [],
  race: null,
};

describe("selectSceneView (#563, ADR 0017)", () => {
  it("lists every member by desk, at the start before the race, with you as self", () => {
    const view = selectSceneView(base);
    expect(view.self).toBe(3);
    expect(view.phase).toBe("waiting");
    expect(view.lamp).toBeNull();
    expect(view.desks.map((d) => d.desk)).toEqual([1, 3, 5]);
    for (const d of view.desks) {
      expect(d).toMatchObject({ status: "typing", rank: null, progress: 0 });
      expect(d.tint).toMatch(/^desk-color-\d+$/);
    }
  });

  it("joins the snapshot: the server's ranks, statuses and the engine's progress", () => {
    const view = selectSceneView({
      ...base,
      phase: "running",
      race: { text: "abcdefghij" },
      desks: [entry(1, 5), entry(3, 10, finished), entry(5, 0)],
      ranks: [3, 1, 5],
    });
    expect(view.phase).toBe("running");
    expect(view.desks).toEqual([
      expect.objectContaining({ desk: 1, rank: 2, progress: 0.5, status: "typing" }),
      expect.objectContaining({ desk: 3, rank: 1, progress: 1, status: "finished" }),
      expect.objectContaining({ desk: 5, rank: 3, progress: 0, status: "typing" }),
    ]);
  });

  it("keeps its reference while nothing the scene reads changed", () => {
    const source = { ...base, members: [member(2), member(4)] };
    const first = selectSceneView(source);
    // a keystroke: a new state object, the same roster and snapshot
    expect(selectSceneView({ ...source })).toBe(first);
    expect(selectSceneView({ ...source, you: 4 })).not.toBe(first);
  });

  it("maps the seat's own phases onto the room's", () => {
    expect(selectSceneView({ ...base, phase: "connecting" }).phase).toBe("waiting");
    expect(selectSceneView({ ...base, phase: "reconnecting", race: { text: "a" } }).phase).toBe(
      "running",
    );
    expect(selectSceneView({ ...base, phase: "ended", race: { text: "a" } }).phase).toBe("ended");
  });
});
