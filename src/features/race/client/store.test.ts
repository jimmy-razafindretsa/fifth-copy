import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  PROTOCOL_VERSION,
  roomCodeSchema,
  type Member,
  type Roster,
  type Welcome,
} from "@fifth-copy/protocol";
import type { IoFactory } from "./socket";

// Contracts of #561 C2 (the pure, table-tested reducer) and C3 (the store, `useRaceStore` on
// `useSyncExternalStore` with a server snapshot, `bindRaceSocket` and its unbind). `react` is the real
// one; only `useSyncExternalStore` is wrapped in a spy, so the hook's three arguments can be inspected.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useSyncExternalStore: vi.fn(actual.useSyncExternalStore) };
});

const react = await import("react");
const { bindRaceSocket, createRaceStore, initialRaceState, reduceRace } = await import("./store");
const { RaceStoreProvider, useRaceStore } = await import("./use-race-store");
const { connectToRoom } = await import("./socket");
type RaceEvent = import("./store").RaceEvent;
type RaceState = import("./store").RaceState;

const member = (desk: number, name: string, isHost = false): Member => ({
  desk,
  name,
  isHost,
  isBot: false,
  color: (desk - 1) % 12,
  marker: (["circle", "square", "triangle", "diamond"] as const)[Math.floor((desk - 1) / 12) % 4]!,
});

const KEY = "k".repeat(40);
const welcome = (over: Partial<Welcome> = {}): Welcome => ({
  v: PROTOCOL_VERSION,
  role: "player",
  you: 5,
  room: { code: roomCodeSchema.parse("KGB-4821"), phase: "waiting" },
  members: [member(5, "Lynx-785"), member(1, "Sparrow-137", true), member(3, "Heron-411")],
  settings: DEFAULT_RACE_SETTINGS,
  race: null,
  state: null,
  overlay: null,
  resumeKey: KEY,
  serverNow: 1_767_225_600_000,
  ...over,
});

const run = (...events: RaceEvent[]) => events.reduce(reduceRace, initialRaceState);
const desks = (s: RaceState) => s.members.map((m) => m.desk);

/** Deep-freezes a value so a reducer that mutates its input throws. */
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) freeze(v);
  }
  return value;
}

afterEach(() => vi.restoreAllMocks());

describe("reduceRace (#561 C2)", () => {
  it("starts connecting with nothing known", () => {
    expect(initialRaceState).toEqual({
      phase: "connecting",
      lost: null,
      room: null,
      role: null,
      you: null,
      members: [],
      settings: null,
      race: null,
      state: null,
      overlay: null,
      resumeKey: null,
      serverNow: null,
    });
  });

  it("connecting -> waiting on a welcome in a waiting room, keeping everything later cards read", () => {
    const w = welcome();
    const s = run({ type: "welcome", payload: w });
    expect(s.phase).toBe("waiting");
    expect(s.lost).toBeNull();
    expect(s.room).toEqual({ code: "KGB-4821", phase: "waiting" });
    expect(s.role).toBe("player");
    expect(s.you).toBe(5);
    expect(s.settings).toBe(w.settings);
    expect(s.race).toBeNull();
    expect(s.state).toBeNull();
    expect(s.overlay).toBeNull();
    expect(s.resumeKey).toBe(KEY);
    expect(s.serverNow).toBe(w.serverNow);
    expect(desks(s)).toEqual([1, 3, 5]);
  });

  it("keeps race, state and overlay from a welcome mid-race, and the room's phase", () => {
    const race = {
      raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
      text: "Le reçu du café est prêt.",
      language: "fr" as const,
      wordCount: 5,
      t0: 1_767_225_603_000,
      timerS: DEFAULT_RACE_SETTINGS.timerS,
    };
    const state = {
      cursor: 3,
      correct: 3,
      errors: 0,
      total: 3,
      typed: ["L", "e", " "],
      status: "typing" as const,
      lastT: 900,
      finishedAt: null,
    };
    const overlay = { extra: [], removed: [1] };
    const s = run({
      type: "welcome",
      payload: welcome({
        room: { code: roomCodeSchema.parse("KGB-4821"), phase: "running" },
        race,
        state,
        overlay,
      }),
    });
    expect(s.phase).toBe("running");
    expect(s.race).toEqual(race);
    expect(s.state).toEqual(state);
    expect(s.overlay).toEqual(overlay);
  });

  it("waiting -> reconnecting -> waiting on reconnecting / reconnected", () => {
    const waiting = run({ type: "welcome", payload: welcome() });
    const cut = reduceRace(waiting, { type: "reconnecting" });
    expect(cut.phase).toBe("reconnecting");
    expect(cut.members).toBe(waiting.members);
    expect(reduceRace(cut, { type: "reconnected" }).phase).toBe("waiting");
  });

  it("a transport connect error reconnects; reconnected before any welcome is connecting again", () => {
    const s = run({ type: "connect-error", reason: "transport" });
    expect(s.phase).toBe("reconnecting");
    expect(s.lost).toBeNull();
    expect(reduceRace(s, { type: "reconnected" }).phase).toBe("connecting");
    const waiting = run({ type: "welcome", payload: welcome() });
    const again = reduceRace(waiting, { type: "connect-error", reason: "transport" });
    expect(reduceRace(again, { type: "reconnected" }).phase).toBe("waiting");
  });

  it.each(["closed", "no-room", "bad-token", "version", "in-progress"] as const)(
    "a %s refusal is lost, from connecting and from waiting",
    (reason) => {
      expect(run({ type: "connect-error", reason })).toMatchObject({ phase: "lost", lost: reason });
      const waiting = run({ type: "welcome", payload: welcome() });
      expect(reduceRace(waiting, { type: "connect-error", reason })).toMatchObject({
        phase: "lost",
        lost: reason,
        members: waiting.members,
      });
    },
  );

  it.each(["not-found", "closed", "generic"] as const)("a %s token error is lost", (error) => {
    expect(run({ type: "token-error", error })).toMatchObject({ phase: "lost", lost: error });
  });

  it("lost is terminal: nothing later revives the page", () => {
    const lost = run({ type: "connect-error", reason: "no-room" });
    for (const event of [
      { type: "welcome", payload: welcome() },
      { type: "roster", payload: { v: PROTOCOL_VERSION, members: [member(2, "Crow-274")] } },
      { type: "reconnecting" },
      { type: "reconnected" },
      { type: "connect-error", reason: "transport" },
      { type: "token-error", error: "generic" },
    ] satisfies RaceEvent[]) {
      expect(reduceRace(lost, event), event.type).toBe(lost);
    }
  });

  it("a roster replaces the members, sorted by desk, and keeps the phase", () => {
    const waiting = run({ type: "welcome", payload: welcome() });
    const s = reduceRace(waiting, {
      type: "roster",
      payload: { v: PROTOCOL_VERSION, members: [member(12, "Otter-644"), member(2, "Crow-274")] },
    });
    expect(desks(s)).toEqual([2, 12]);
    expect(s.phase).toBe("waiting");
    expect(s.you).toBe(5);
  });

  it("is pure: it never mutates the state or the payload it is given", () => {
    const w = freeze(welcome());
    const waiting = freeze(run({ type: "welcome", payload: w }));
    const roster: Roster = freeze({
      v: PROTOCOL_VERSION,
      members: [member(9, "Badger-233"), member(4, "Marmot-548")],
    });
    expect(() => reduceRace(waiting, { type: "roster", payload: roster })).not.toThrow();
    expect(() => reduceRace(waiting, { type: "reconnecting" })).not.toThrow();
    expect(() => reduceRace(waiting, { type: "connect-error", reason: "closed" })).not.toThrow();
    expect(roster.members.map((m) => m.desk)).toEqual([9, 4]);
    // same input, same output
    expect(reduceRace(initialRaceState, { type: "welcome", payload: w })).toEqual(waiting);
  });
});

describe("createRaceStore (#561 C3)", () => {
  it("exposes getState, subscribe and dispatch; listeners hear each change once", () => {
    const store = createRaceStore();
    expect(Object.keys(store).sort()).toEqual(["dispatch", "getState", "subscribe"]);
    expect(store.getState()).toBe(initialRaceState);
    const heard = vi.fn();
    const unsubscribe = store.subscribe(heard);
    store.dispatch({ type: "welcome", payload: welcome() });
    expect(store.getState().phase).toBe("waiting");
    expect(heard).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.dispatch({ type: "reconnecting" });
    expect(store.getState().phase).toBe("reconnecting");
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("an event that changes nothing (the terminal lost) notifies nobody", () => {
    const store = createRaceStore();
    store.dispatch({ type: "connect-error", reason: "closed" });
    const heard = vi.fn();
    store.subscribe(heard);
    const before = store.getState();
    store.dispatch({ type: "welcome", payload: welcome() });
    expect(store.getState()).toBe(before);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe("useRaceStore (#561 C3)", () => {
  const spy = vi.mocked(react.useSyncExternalStore);

  function Probe() {
    const phase = useRaceStore((s) => s.phase);
    const count = useRaceStore((s) => s.members.length);
    return createElement("i", null, `${phase}:${count}`);
  }

  it("reads through useSyncExternalStore: the store's subscribe, its state, and the initial state on the server", () => {
    const store = createRaceStore();
    store.dispatch({ type: "welcome", payload: welcome() });
    spy.mockClear();
    const html = renderToStaticMarkup(
      createElement(RaceStoreProvider, { store }, createElement(Probe)),
    );
    // the server renders the server snapshot: what the HTML must show before hydration
    expect(html).toBe("<i>connecting:0</i>");
    expect(spy).toHaveBeenCalledTimes(2);
    const [subscribe, getSnapshot, getServerSnapshot] = spy.mock.calls[0]!;
    expect(subscribe).toBe(store.subscribe);
    expect(getSnapshot()).toBe("waiting");
    expect(getServerSnapshot?.()).toBe("connecting");
    const [, count, serverCount] = spy.mock.calls[1]!;
    expect(count()).toBe(3);
    expect(serverCount?.()).toBe(0);
  });

  it("a provider without a store creates its own, starting connecting", () => {
    const html = renderToStaticMarkup(createElement(RaceStoreProvider, {}, createElement(Probe)));
    expect(html).toBe("<i>connecting:0</i>");
  });

  it("outside a provider it fails loudly", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderToStaticMarkup(createElement(Probe))).toThrow(/RaceStoreProvider/);
  });
});

describe("bindRaceSocket (#561 C3)", () => {
  type Listener = (...args: unknown[]) => void;
  function emitter() {
    const listeners = new Map<string, Set<Listener>>();
    return {
      listeners,
      on(event: string, fn: Listener) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(fn);
      },
      off(event: string, fn: Listener) {
        listeners.get(event)?.delete(fn);
        if (listeners.get(event)?.size === 0) listeners.delete(event);
      },
      deliver(event: string, ...args: unknown[]) {
        for (const fn of [...(listeners.get(event) ?? [])]) fn(...args);
      },
    };
  }

  /** The real `connectToRoom` over a fake socket.io socket, so unbind is checked on real listeners. */
  function setup() {
    const socket = emitter();
    const manager = emitter();
    const fake = { ...socket, io: manager, emit: vi.fn(), disconnect: vi.fn() };
    const io = vi.fn(() => fake) as unknown as IoFactory;
    return { fake, room: connectToRoom("http://localhost:7561", "tok", { io }) };
  }

  it("turns socket events into race events", () => {
    const { fake, room } = setup();
    const dispatch = vi.fn();
    bindRaceSocket(room, dispatch);
    const w = welcome();
    fake.deliver("welcome", w);
    fake.deliver("roster", { v: PROTOCOL_VERSION, members: [member(2, "Crow-274")] });
    fake.io.deliver("reconnect_attempt", 1);
    fake.io.deliver("reconnect", 1);
    fake.deliver("connect_error", new Error("in-progress"));
    fake.deliver("connect_error", new Error("xhr poll error"));
    expect(dispatch.mock.calls.map(([e]) => e)).toEqual([
      { type: "welcome", payload: w },
      { type: "roster", payload: { v: PROTOCOL_VERSION, members: [member(2, "Crow-274")] } },
      { type: "reconnecting" },
      { type: "reconnected" },
      { type: "connect-error", reason: "in-progress" },
      { type: "connect-error", reason: "transport" },
    ]);
  });

  it("returns an unbind that offs every listener it bound, and only those", () => {
    const { fake, room } = setup();
    const own = vi.fn();
    room.onRoster(own);
    const dispatch = vi.fn();
    const unbind = bindRaceSocket(room, dispatch);
    expect([...fake.listeners.keys()].sort()).toEqual(["connect_error", "roster", "welcome"]);
    expect([...fake.io.listeners.keys()].sort()).toEqual(["reconnect", "reconnect_attempt"]);
    unbind();
    unbind();
    expect([...fake.listeners.keys()]).toEqual(["roster"]);
    expect(fake.listeners.get("roster")!.size).toBe(1);
    expect(fake.io.listeners.size).toBe(0);
    fake.deliver("welcome", welcome());
    fake.deliver("roster", { v: PROTOCOL_VERSION, members: [] });
    fake.io.deliver("reconnect_attempt", 1);
    expect(dispatch).not.toHaveBeenCalled();
    expect(own).toHaveBeenCalledTimes(1);
    expect(fake.disconnect).not.toHaveBeenCalled();
  });

  it("drives a store end to end", () => {
    const { fake, room } = setup();
    const store = createRaceStore();
    bindRaceSocket(room, store.dispatch);
    fake.deliver("welcome", welcome());
    expect(store.getState().phase).toBe("waiting");
    fake.io.deliver("reconnect_attempt", 1);
    expect(store.getState().phase).toBe("reconnecting");
    fake.deliver("connect_error", new Error("closed"));
    expect(store.getState()).toMatchObject({ phase: "lost", lost: "closed" });
  });
});
