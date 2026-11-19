import { describe, expect, it } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  PROTOCOL_VERSION,
  roomCodeSchema,
  type RaceEvent as WireEvent,
  deskIdentity,
  PLAYER_STATUS_CODES,
  type Member,
  type Snapshot,
} from "@fifth-copy/protocol";
import { reduceRace, initialRaceState, type RaceEvent } from "../client/store";
import { sabotageFrom, selectSceneView, type SceneSource } from "./scene-view";

// #563 (ADR 0017 shared core): the one value the seat scene reads, derived from the race store.

const member = (desk: number): Member => ({
  desk,
  name: `Sim-${desk}`,
  isHost: desk === 1,
  isBot: false,
  ...deskIdentity(desk),
  avatar: null,
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

  // #999 C5 (bible 10.3 "Lamp"): the Major's lamp is on the leader while the room runs, else it hangs down
  it("#999 C5: the lamp is the desk at ranks[0] while running, else null", () => {
    const running = { ...base, phase: "running", race: { text: "abcdefghij" }, desks: [entry(1, 2), entry(3, 6), entry(5, 4)] };
    expect(selectSceneView({ ...running, ranks: [3, 5, 1] }).lamp).toBe(3);
    expect(selectSceneView({ ...running, ranks: [5, 3, 1] }).lamp).toBe(5);
    expect(selectSceneView({ ...running, ranks: [] }).lamp).toBeNull();
    for (const phase of ["waiting", "loading", "countdown", "ended"])
      expect(selectSceneView({ ...running, phase, ranks: [3, 5, 1] }).lamp).toBeNull();
  });

  it("#926 C4: the room's loading is the scene's countdown (no embed or fc-* change)", () => {
    expect(selectSceneView({ ...base, phase: "loading", race: { text: "a" } }).phase).toBe(
      "countdown",
    );
  });
});

// Contract of #999 C61: a pure mapping turns each `bonus-sent` into exactly one `fc-race-sabotage` play
// (same kind, from and to); nothing for replayed events (welcome, reconnect), before GO or after the end.
describe("sabotageFrom (#999 C61)", () => {
  const v = PROTOCOL_VERSION;
  const sent = (
    from: number,
    to: number[],
    bonus: "extra-paperwork" | "exemption" | "smoke-break",
  ) => ({ v, kind: "bonus-sent", from, to, bonus }) as WireEvent;

  it.each([
    ["extra-paperwork", 2, [1, 3]],
    ["smoke-break", 4, [1, 2, 3, 5, 6]],
    ["exemption", 6, [6]],
  ] as const)("maps a running %s play one to one", (bonus, from, to) => {
    expect(sabotageFrom(sent(from, [...to], bonus), "running")).toEqual({
      kind: bonus,
      from,
      to,
    });
  });

  it.each(["connecting", "waiting", "loading", "countdown", "reconnecting", "ended", "lost"])(
    "sends nothing while the seat is %s (before GO, a cut line, after the end)",
    (phase) => {
      expect(sabotageFrom(sent(2, [1], "smoke-break"), phase)).toBeNull();
    },
  );

  it("maps no other event", () => {
    const earned = { v, kind: "bonus-earned", desk: 2, bonus: "exemption" } as WireEvent;
    expect(sabotageFrom(earned, "running")).toBeNull();
  });

  it("through the store: one play per bonus-sent, none replayed by a welcome or a reconnect", () => {
    const RACE = {
      raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
      text: "ab cd",
      language: "en" as const,
      wordCount: 2,
      t0: 1_000,
      timerS: 60,
    };
    const welcome = (phase: "waiting" | "running"): RaceEvent => ({
      type: "welcome",
      payload: {
        v,
        role: "player",
        you: 1,
        room: { code: roomCodeSchema.parse("KGB-4821"), phase },
        members: [member(1), member(2)],
        settings: DEFAULT_RACE_SETTINGS,
        race: phase === "running" ? RACE : null,
        state: null,
        overlay: null,
        bonus: null,
        resumeKey: null,
        serverNow: 0,
        autoStartAt: null,
        pending: null,
      },
    });
    const event = (payload: WireEvent): RaceEvent => ({ type: "event", payload, at: 2_000 });
    const plays: number[] = [];
    let state = initialRaceState;
    const step = (e: RaceEvent) => {
      const before = state.sabotage;
      state = reduceRace(state, e);
      if (state.sabotage && state.sabotage !== before) plays.push(state.sabotage.seq);
    };
    step(welcome("waiting"));
    step(event(sent(2, [1], "smoke-break"))); // before GO
    step({ type: "countdown", payload: { v, race: RACE } });
    step({ type: "go" });
    step(event(sent(2, [1], "smoke-break")));
    step(event(sent(1, [1], "exemption")));
    step({ type: "disconnected" });
    step(welcome("running")); // the reconnect's welcome
    expect(state.sabotage).toBeNull();
    step(event(sent(2, [1], "extra-paperwork")));
    step({
      type: "ended",
      payload: { v, raceId: RACE.raceId, reason: "timer", ranking: [] },
      at: 3_000,
    });
    step(event(sent(2, [1], "extra-paperwork"))); // after the end
    expect(plays).toEqual([1, 2, 3]);
  });

  // #999 C66: a spectator's store (the projector, a phone) maps every `bonus-sent` the way a seat does
  it("a spectator store takes the same plays as a seat, in the same order", () => {
    const RACE = {
      raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
      text: "ab cd",
      language: "en" as const,
      wordCount: 2,
      t0: 1_000,
      timerS: 60,
    };
    const welcome = (role: "player" | "spectator"): RaceEvent => ({
      type: "welcome",
      payload: {
        v,
        role,
        you: role === "player" ? 1 : null,
        room: { code: roomCodeSchema.parse("KGB-4821"), phase: "waiting" },
        members: [member(1), member(2), member(3)],
        settings: DEFAULT_RACE_SETTINGS,
        race: null,
        state: null,
        overlay: null,
        bonus: null,
        resumeKey: null,
        serverNow: 0,
        autoStartAt: null,
        pending: null,
      },
    });
    const event = (payload: WireEvent): RaceEvent => ({ type: "event", payload, at: 2_000 });
    const plays = (role: "player" | "spectator") => {
      const out: unknown[] = [];
      let state = initialRaceState;
      for (const e of [
        welcome(role),
        { type: "countdown", payload: { v, race: RACE } } as RaceEvent,
        { type: "go" } as RaceEvent,
        event(sent(2, [1], "extra-paperwork")),
        event(sent(3, [1, 2], "smoke-break")),
        event(sent(3, [3], "exemption")),
      ]) {
        const before = state.sabotage;
        state = reduceRace(state, e);
        if (state.sabotage && state.sabotage !== before) out.push(state.sabotage);
      }
      return out;
    };
    expect(plays("spectator")).toHaveLength(3);
    expect(plays("spectator")).toEqual(plays("player"));
  });
});
