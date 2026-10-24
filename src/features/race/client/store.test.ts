import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  PLAYER_STATUS_CODES,
  PROTOCOL_VERSION,
  roomCodeSchema,
  type Countdown,
  type Member,
  type Roster,
  type Snapshot,
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
const {
  bindRaceSocket,
  createRaceStore,
  initialRaceState,
  reduceRace,
  selectCanType,
  selectTypedView,
} = await import("./store");
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
      clockOffset: 0,
      // #559: the viewer's typing and the last snapshot
      prediction: null,
      desks: [],
      ranks: [],
      // #220: the last key the engine took from you
      lastKey: null,
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
    const settings = { ...DEFAULT_RACE_SETTINGS, errorMode: "block" as const };
    fake.deliver("settings", { v: PROTOCOL_VERSION, settings }); // #654 C2
    fake.io.deliver("reconnect_attempt", 1);
    fake.io.deliver("reconnect", 1);
    fake.deliver("connect_error", new Error("in-progress"));
    fake.deliver("connect_error", new Error("xhr poll error"));
    expect(dispatch.mock.calls.map(([e]) => e)).toEqual([
      // #214: the welcome carries the local time it arrived at, for the clock offset
      { type: "welcome", payload: w, receivedAt: expect.any(Number) },
      { type: "roster", payload: { v: PROTOCOL_VERSION, members: [member(2, "Crow-274")] } },
      { type: "settings", payload: { v: PROTOCOL_VERSION, settings } },
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
    expect([...fake.listeners.keys()].sort()).toEqual([
      "connect_error",
      "countdown",
      "roster",
      "settings",
      "snapshot",
      "welcome",
    ]);
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

// Contract of #214 C1 (the store half): `countdown` stores the race and enters the countdown; `go` turns
// it `running`. `bindRaceSocket` schedules `go` with an injected timer at `race.t0` on the corrected
// clock (`welcome.serverNow` sets the offset), from a `countdown` event and from a `welcome` that finds
// the room counting down (the seat view opened from the lobby connects after the broadcast), and its
// unbind cancels it.
describe("countdown and GO (#214 C1)", () => {
  const RACE = {
    raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
    text: "Le reçu du café est prêt.",
    language: "fr" as const,
    wordCount: 5,
    t0: 1_767_225_603_000,
    timerS: DEFAULT_RACE_SETTINGS.timerS,
  };
  const code = roomCodeSchema.parse("KGB-4821");
  const countdown = (race = RACE): Countdown => ({ v: PROTOCOL_VERSION, race });

  describe("reduceRace", () => {
    it("waiting -> countdown: stores the race and the room's phase, keeps the rest", () => {
      const waiting = run({ type: "welcome", payload: welcome() });
      const s = reduceRace(waiting, { type: "countdown", payload: countdown() });
      expect(s.phase).toBe("countdown");
      expect(s.race).toEqual(RACE);
      expect(s.race).toMatchObject({ raceId: RACE.raceId, text: RACE.text, t0: RACE.t0 });
      expect(s.race?.timerS).toBe(RACE.timerS);
      expect(s.room).toEqual({ code, phase: "countdown" });
      expect(s.members).toBe(waiting.members);
      expect(s.you).toBe(5);
    });

    it("countdown -> running on go; go outside a countdown changes nothing", () => {
      const counting = run(
        { type: "welcome", payload: welcome() },
        { type: "countdown", payload: countdown() },
      );
      const s = reduceRace(counting, { type: "go" });
      expect(s.phase).toBe("running");
      expect(s.room?.phase).toBe("running");
      expect(s.race).toBe(counting.race);
      const waiting = run({ type: "welcome", payload: welcome() });
      expect(reduceRace(waiting, { type: "go" })).toBe(waiting);
      expect(reduceRace(s, { type: "go" })).toBe(s);
    });

    it("go while the line is cut keeps reconnecting; the reconnect lands running", () => {
      const cut = run(
        { type: "welcome", payload: welcome() },
        { type: "countdown", payload: countdown() },
        { type: "reconnecting" },
      );
      const s = reduceRace(cut, { type: "go" });
      expect(s.phase).toBe("reconnecting");
      expect(reduceRace(s, { type: "reconnected" }).phase).toBe("running");
    });

    it("a welcome in a counting-down room enters the countdown with its race", () => {
      const s = run({
        type: "welcome",
        payload: welcome({ room: { code, phase: "countdown" }, race: RACE }),
      });
      expect(s.phase).toBe("countdown");
      expect(s.race).toEqual(RACE);
    });

    it("a welcome sets the clock offset from serverNow and the local receipt time", () => {
      const w = welcome({ serverNow: 1_767_225_600_400 });
      const s = run({ type: "welcome", payload: w, receivedAt: 1_767_225_600_000 });
      expect(s.clockOffset).toBe(400);
      // without a receipt time the offset is kept
      expect(reduceRace(s, { type: "welcome", payload: w }).clockOffset).toBe(400);
    });

    it("lost stays terminal and the new cases stay pure", () => {
      const lost = run({ type: "connect-error", reason: "closed" });
      expect(reduceRace(lost, { type: "countdown", payload: countdown() })).toBe(lost);
      expect(reduceRace(lost, { type: "go" })).toBe(lost);
      const waiting = freeze(run({ type: "welcome", payload: welcome() }));
      const payload = freeze(countdown());
      expect(() => reduceRace(waiting, { type: "countdown", payload })).not.toThrow();
      const counting = freeze(reduceRace(waiting, { type: "countdown", payload }));
      expect(() => reduceRace(counting, { type: "go" })).not.toThrow();
    });
  });

  /** A manual timer: `now` is this device's clock; `advance` fires what falls due, in order. */
  function fakeTimer(start = 1_767_225_600_000) {
    let now = start;
    let next = 0;
    const due = new Map<number, { at: number; fn: () => void }>();
    return {
      timer: {
        now: () => now,
        setTimeout: (fn: () => void, ms: number) => {
          due.set(++next, { at: now + ms, fn });
          return next;
        },
        clearTimeout: (handle: unknown) => void due.delete(handle as number),
      },
      advance(ms: number) {
        const until = now + ms;
        for (;;) {
          const first = [...due].sort(([, a], [, b]) => a.at - b.at)[0];
          if (!first || first[1].at > until) break;
          due.delete(first[0]);
          now = first[1].at;
          first[1].fn();
        }
        now = until;
      },
      pending: () => due.size,
      get now() {
        return now;
      },
    };
  }

  /** The real `connectToRoom` over a fake socket.io socket (the events are parsed as in the app). */
  function makeRoom() {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const fake = {
      listeners,
      on: (event: string, fn: (...args: unknown[]) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(fn);
      },
      off: (event: string, fn: (...args: unknown[]) => void) => listeners.get(event)?.delete(fn),
      deliver: (event: string, ...args: unknown[]) => {
        for (const fn of [...(listeners.get(event) ?? [])]) fn(...args);
      },
      io: { on: vi.fn(), off: vi.fn() },
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
    const io = vi.fn(() => fake) as unknown as IoFactory;
    return { fake, room: connectToRoom("http://localhost:7214", "tok", { io }) };
  }

  function setup() {
    const { fake, room } = makeRoom();
    const clock = fakeTimer();
    const dispatch = vi.fn();
    const unbind = bindRaceSocket(room, dispatch, { timer: clock.timer });
    const gos = () => dispatch.mock.calls.filter(([e]) => e.type === "go").length;
    return { fake, clock, dispatch, unbind, gos };
  }

  it("schedules go at t0 on the corrected clock after a countdown event", () => {
    const { fake, clock, gos, dispatch } = setup();
    // the server is 500 ms ahead of this device
    fake.deliver("welcome", welcome({ serverNow: clock.now + 500 }));
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ type: "welcome", receivedAt: clock.now });
    clock.advance(100);
    const t0 = clock.now + 500 + 3_000; // GO 3 s from now, on the server's clock
    fake.deliver("countdown", countdown({ ...RACE, t0 }));
    expect(dispatch.mock.calls.at(-1)![0]).toEqual({
      type: "countdown",
      payload: countdown({ ...RACE, t0 }),
    });
    clock.advance(2_999);
    expect(gos()).toBe(0);
    clock.advance(1);
    expect(gos()).toBe(1);
    expect(dispatch.mock.calls.at(-1)![0]).toEqual({ type: "go" });
  });

  it("schedules go from a welcome that finds the room counting down", () => {
    const { fake, clock, gos } = setup();
    const serverNow = clock.now - 250; // the device is 250 ms ahead
    fake.deliver(
      "welcome",
      welcome({
        serverNow,
        room: { code, phase: "countdown" },
        race: { ...RACE, t0: serverNow + 1_800 },
      }),
    );
    clock.advance(1_799);
    expect(gos()).toBe(0);
    clock.advance(1);
    expect(gos()).toBe(1);
  });

  it("a welcome that arrives after t0 goes at once (zero delay, never negative)", () => {
    const { fake, clock, gos } = setup();
    fake.deliver(
      "welcome",
      welcome({
        serverNow: clock.now,
        room: { code, phase: "countdown" },
        race: { ...RACE, t0: clock.now - 40 },
      }),
    );
    expect(gos()).toBe(0);
    clock.advance(0);
    expect(gos()).toBe(1);
  });

  it("one go per countdown: a repeated countdown or a later welcome reschedules or cancels it", () => {
    const { fake, clock, gos } = setup();
    fake.deliver("welcome", welcome({ serverNow: clock.now }));
    fake.deliver("countdown", countdown({ ...RACE, t0: clock.now + 3_000 }));
    fake.deliver("countdown", countdown({ ...RACE, t0: clock.now + 2_000 }));
    expect(clock.pending()).toBe(1);
    clock.advance(5_000);
    expect(gos()).toBe(1);
    // a welcome that no longer counts down (the race was voided) cancels the pending go
    fake.deliver("countdown", countdown({ ...RACE, t0: clock.now + 3_000 }));
    fake.deliver("welcome", welcome({ serverNow: clock.now }));
    expect(clock.pending()).toBe(0);
    clock.advance(5_000);
    expect(gos()).toBe(1);
  });

  it("the unbind cancels a pending go and offs the countdown listener", () => {
    const { fake, clock, gos, unbind } = setup();
    fake.deliver("welcome", welcome({ serverNow: clock.now }));
    fake.deliver("countdown", countdown({ ...RACE, t0: clock.now + 3_000 }));
    unbind();
    expect(clock.pending()).toBe(0);
    clock.advance(10_000);
    expect(gos()).toBe(0);
    expect(fake.listeners.get("countdown")?.size ?? 0).toBe(0);
  });

  it("drives a store from waiting to running", () => {
    const { fake, room } = makeRoom();
    const store = createRaceStore();
    const clock = fakeTimer();
    bindRaceSocket(room, store.dispatch, { timer: clock.timer });
    fake.deliver("welcome", welcome({ serverNow: clock.now }));
    expect(store.getState().phase).toBe("waiting");
    fake.deliver("countdown", countdown({ ...RACE, t0: clock.now + 3_000 }));
    expect(store.getState().phase).toBe("countdown");
    clock.advance(3_000);
    expect(store.getState().phase).toBe("running");
  });
});

// Contract of #559 C5: the store's `snapshot` case keeps `desks` and `ranks` and reconciles the viewer's
// prediction (ARCHITECTURE 7.3); the `key` case applies a keystroke locally; `typedViewFrom` is memoised per
// prediction state, so the HUD re-renders once per keystroke or diverging snapshot and not at all for a
// snapshot that agrees.
describe("typing and snapshots (#559 C5)", () => {
  const TEXT = "Le reçu";
  const RACE = {
    raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
    text: TEXT,
    language: "fr" as const,
    wordCount: 2,
    t0: 1_767_225_603_000,
    timerS: DEFAULT_RACE_SETTINGS.timerS,
  };
  const code = roomCodeSchema.parse("KGB-4821");
  const countdown = (race = RACE): Countdown => ({ v: PROTOCOL_VERSION, race });
  const running = (w = welcome()) =>
    run(
      { type: "welcome", payload: w },
      { type: "countdown", payload: countdown() },
      { type: "go" },
    );
  const key = (key: string, t: number): RaceEvent => ({ type: "key", keystroke: { t, key } });
  const typing = PLAYER_STATUS_CODES.typing;
  const snapshot = (
    desks: Snapshot["desks"],
    t = 500,
    ranks = desks.map((d) => d[0]),
  ): RaceEvent => ({
    type: "snapshot",
    payload: { v: PROTOCOL_VERSION, t, desks, ranks },
  });
  const typed = (s: RaceState) =>
    selectTypedView(s)
      .chars.map((c) => c.state[0])
      .join("");

  it("the countdown builds your prediction over the race text; a spectator gets none", () => {
    const counting = run(
      { type: "welcome", payload: welcome() },
      { type: "countdown", payload: countdown() },
    );
    expect(counting.prediction?.text).toBe(TEXT);
    expect(counting.prediction?.settings).toEqual({ errorMode: "continue", backspace: true });
    expect(counting.prediction?.state.cursor).toBe(0);
    const spectator = run(
      { type: "welcome", payload: welcome({ role: "spectator", you: null }) },
      { type: "countdown", payload: countdown() },
    );
    expect(spectator.prediction).toBeNull();
  });

  it("the host's error mode reaches the engine (engineSettingsOf)", () => {
    const block = running(
      welcome({ settings: { ...DEFAULT_RACE_SETTINGS, errorMode: "block", backspace: false } }),
    );
    expect(block.prediction?.settings).toEqual({ errorMode: "block", backspace: false });
    const s = reduceRace(block, key("x", 10));
    expect(s.prediction?.state).toMatchObject({ cursor: 0, errors: 1 });
    expect(selectTypedView(s).jammed).toBe(true);
  });

  it("a welcome mid-race starts the prediction from your authoritative state and overlay", () => {
    const state = {
      cursor: 2,
      correct: 2,
      errors: 0,
      total: 2,
      typed: [null, null],
      status: "typing" as const,
      lastT: 900,
      finishedAt: null,
    };
    const s = run({
      type: "welcome",
      payload: welcome({
        room: { code, phase: "running" },
        race: { ...RACE, text: "un deux trois" },
        state,
        overlay: { extra: [], removed: [1] },
      }),
    });
    expect(s.prediction?.text).toBe("un trois");
    expect(s.prediction?.state).toEqual(state);
    expect(typed(s).slice(0, 3)).toBe("ddn");
  });

  it("a key is applied only while running", () => {
    const counting = run(
      { type: "welcome", payload: welcome() },
      { type: "countdown", payload: countdown() },
    );
    expect(reduceRace(counting, key("L", 0))).toBe(counting);
    const s = reduceRace(running(), key("L", 40));
    expect(s.prediction?.state.cursor).toBe(1);
    expect(s.prediction?.unacked).toEqual([{ t: 40, key: "L" }]);
    expect(typed(s).slice(0, 2)).toBe("dn");
    // a key the engine refuses changes nothing
    const done = [..."Le reçu"].reduce((x, k, i) => reduceRace(x, key(k, 40 * (i + 1))), running());
    expect(done.prediction?.state.status).toBe("finished");
    expect(reduceRace(done, key("x", 1_000))).toBe(done);
  });

  it("sent counts the keys handed to the server", () => {
    const s = reduceRace(reduceRace(running(), key("L", 40)), key("e", 80));
    expect(reduceRace(s, { type: "sent", count: 2 }).prediction?.sent).toBe(2);
    expect(reduceRace(running(), { type: "sent", count: 1 }).prediction?.sent).toBe(0);
  });

  it("a snapshot keeps desks and ranks and reconciles your desk's prediction", () => {
    const s = reduceRace(reduceRace(running(), key("L", 40)), { type: "sent", count: 1 });
    const reconcile = vi.spyOn(s.prediction!, "reconcile");
    const desks: Snapshot["desks"] = [
      [1, 4, 4, 0, typing],
      [3, 0, 0, 0, typing],
      [5, 1, 1, 0, typing],
    ];
    const next = reduceRace(s, snapshot(desks, 500, [1, 5, 3]));
    expect(next.desks).toEqual(desks);
    expect(next.ranks).toEqual([1, 5, 3]);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith(
      { cursor: 1, correct: 1, errors: 0, status: "typing" },
      1,
    );
    expect(next.prediction?.unacked).toEqual([]);
    // a snapshot without your desk (a spectator, or before your seat is in it) keeps desks only
    const other = reduceRace(s, snapshot([[1, 4, 4, 0, typing]]));
    expect(other.prediction).toBe(s.prediction);
  });

  it("a diverging snapshot converges: the server's state plus the keys it has not seen", () => {
    // L, e sent; then ␠ typed and not yet sent
    let s = reduceRace(reduceRace(running(), key("L", 40)), key("e", 80));
    s = reduceRace(reduceRace(s, { type: "sent", count: 2 }), key(" ", 120));
    expect(s.prediction?.state.cursor).toBe(3);
    // the server counted one of the two sent keys wrong: no prefix of the prediction matches it
    s = reduceRace(s, snapshot([[5, 2, 1, 1, typing]]));
    expect(s.prediction?.base).toMatchObject({ cursor: 2, correct: 1, errors: 1 });
    expect(s.prediction?.unacked).toEqual([{ t: 120, key: " " }]);
    expect(s.prediction?.state).toMatchObject({ cursor: 3, correct: 2, errors: 1 });
    // the next snapshot agrees: it settles with nothing left unacked
    s = reduceRace(reduceRace(s, { type: "sent", count: 1 }), snapshot([[5, 3, 2, 1, typing]]));
    expect(s.prediction?.unacked).toEqual([]);
    expect(s.prediction?.state).toMatchObject({ cursor: 3, correct: 2, errors: 1 });
  });

  it("a status the server decided (asleep) locks typing", () => {
    const s = reduceRace(running(), snapshot([[5, 0, 0, 0, PLAYER_STATUS_CODES.asleep]]));
    expect(s.prediction?.state.status).toBe("asleep");
    expect(selectCanType(s)).toBe(false);
  });

  it("selectCanType: only while running, with a desk, before your own finish", () => {
    expect(selectCanType(initialRaceState)).toBe(false);
    expect(selectCanType(run({ type: "welcome", payload: welcome() }))).toBe(false);
    const counting = run(
      { type: "welcome", payload: welcome() },
      { type: "countdown", payload: countdown() },
    );
    expect(selectCanType(counting)).toBe(false);
    expect(selectCanType(running())).toBe(true);
    const done = [..."Le reçu"].reduce((x, k, i) => reduceRace(x, key(k, 40 * (i + 1))), running());
    expect(selectCanType(done)).toBe(false);
    expect(selectCanType(reduceRace(running(), { type: "reconnecting" }))).toBe(false);
  });

  it("selectTypedView is memoised per prediction state: the HUD re-renders once per keystroke or diverging snapshot", () => {
    const store = createRaceStore(running());
    const views: unknown[] = [];
    let last = selectTypedView(store.getState());
    // what useSyncExternalStore does: re-render when the selected value changes
    store.subscribe(() => {
      const view = selectTypedView(store.getState());
      if (view !== last) views.push(view);
      last = view;
    });
    expect(selectTypedView(store.getState())).toBe(last);
    store.dispatch(key("L", 40));
    expect(views).toHaveLength(1);
    store.dispatch({ type: "sent", count: 1 });
    expect(views).toHaveLength(1);
    // the server agrees: no new view
    store.dispatch(snapshot([[5, 1, 1, 0, typing]], 100));
    store.dispatch(snapshot([[5, 1, 1, 0, typing]], 200));
    expect(views).toHaveLength(1);
    store.dispatch(key("e", 80));
    store.dispatch(key(" ", 120));
    expect(views).toHaveLength(3);
    // a rival's progress changes nothing on your sheet
    store.dispatch(
      snapshot(
        [
          [1, 3, 3, 0, typing],
          [5, 1, 1, 0, typing],
        ],
        300,
      ),
    );
    expect(views).toHaveLength(3);
    // the server diverges: exactly one new view
    store.dispatch({ type: "sent", count: 2 });
    store.dispatch(snapshot([[5, 2, 1, 1, typing]], 400));
    expect(views).toHaveLength(4);
  });

  it("before a race the typed view is the empty one, the same object on every read", () => {
    const view = selectTypedView(initialRaceState);
    expect(view).toEqual({ chars: [], cursor: 0, jammed: false, lastTypedAt: null });
    expect(selectTypedView(run({ type: "welcome", payload: welcome() }))).toBe(view);
  });

  it("lost stays terminal and the new cases stay pure", () => {
    const lost = run({ type: "connect-error", reason: "closed" });
    for (const event of [
      key("L", 1),
      { type: "sent", count: 1 },
      snapshot([]),
    ] satisfies RaceEvent[]) {
      expect(reduceRace(lost, event), event.type).toBe(lost);
    }
    const s = freeze(reduceRace(running(), key("L", 40)));
    const payload = freeze(snapshot([[5, 1, 1, 0, typing]]));
    expect(() => reduceRace(s, payload)).not.toThrow();
    expect(() => reduceRace(s, key("e", 80))).not.toThrow();
  });

  it("bindRaceSocket turns a snapshot into a snapshot event", () => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const fake = {
      on: (event: string, fn: (...args: unknown[]) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(fn);
      },
      off: (event: string, fn: (...args: unknown[]) => void) => listeners.get(event)?.delete(fn),
      io: { on: vi.fn(), off: vi.fn() },
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
    const room = connectToRoom("http://localhost:7559", "tok", {
      io: vi.fn(() => fake) as unknown as IoFactory,
    });
    const dispatch = vi.fn();
    bindRaceSocket(room, dispatch);
    const payload: Snapshot = { v: PROTOCOL_VERSION, t: 100, desks: [[5, 1, 1, 0, 0]], ranks: [5] };
    for (const fn of listeners.get("snapshot") ?? []) fn(payload);
    expect(dispatch).toHaveBeenCalledWith({ type: "snapshot", payload });
  });
});

// Contract of #220 C1: the host's error mode and backspace rule reach the engine from `welcome.settings`
// (`engineSettingsOf`); the store records the last key the engine took (`lastKey`, `wrong` exactly when
// the engine's errors grew) and the typed view shows the engine's jam. No rule here: the engine decides.
describe("error modes, the jam and lastKey (#220 C1)", () => {
  const TEXT = "Le reçu";
  const RACE = {
    raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
    text: TEXT,
    language: "fr" as const,
    wordCount: 2,
    t0: 1_767_225_603_000,
    timerS: DEFAULT_RACE_SETTINGS.timerS,
  };
  const raceIn = (errorMode: "continue" | "block", backspace = true) =>
    run(
      {
        type: "welcome",
        payload: welcome({ settings: { ...DEFAULT_RACE_SETTINGS, errorMode, backspace } }),
      },
      { type: "countdown", payload: { v: PROTOCOL_VERSION, race: RACE } },
      { type: "go" },
    );
  const press = (s: RaceState, key: string, t: number) =>
    reduceRace(s, { type: "key", keystroke: { t, key } });
  const errorsOf = (s: RaceState) => s.prediction?.state.errors;
  const states = (s: RaceState) =>
    selectTypedView(s)
      .chars.map((c) => c.state[0])
      .join("");

  it("Block: wrong, wrong, then the right key on the first char: jammed with the cursor held, then released at 1 with 2 errors", () => {
    let s = raceIn("block");
    expect(s.prediction?.settings).toEqual({ errorMode: "block", backspace: true });
    for (const [errors, t] of [
      [1, 10],
      [2, 20],
    ] as const) {
      s = press(s, "x", t);
      expect(selectTypedView(s)).toMatchObject({ jammed: true, cursor: 0 });
      expect(states(s)).toBe("nrrrrrr");
      expect(errorsOf(s)).toBe(errors);
      expect(s.lastKey).toEqual({ key: "x", t, wrong: true });
    }
    s = press(s, "L", 30);
    expect(selectTypedView(s)).toMatchObject({ jammed: false, cursor: 1 });
    expect(states(s)).toBe("dnrrrrr");
    expect(errorsOf(s)).toBe(2);
    expect(s.lastKey).toEqual({ key: "L", t: 30, wrong: false });
  });

  it("Continue: the same keys never jam; each wrong key is a wrong span and the cursor moves on", () => {
    let s = raceIn("continue");
    expect(s.prediction?.settings).toEqual({ errorMode: "continue", backspace: true });
    s = press(s, "x", 10);
    expect(selectTypedView(s)).toMatchObject({ jammed: false, cursor: 1 });
    expect(states(s)).toBe("wnrrrrr");
    s = press(s, "x", 20);
    expect(selectTypedView(s)).toMatchObject({ jammed: false, cursor: 2 });
    s = press(s, "L", 30);
    expect(selectTypedView(s)).toMatchObject({ jammed: false, cursor: 3 });
    expect(states(s)).toBe("wwwnrrr");
    expect(errorsOf(s)).toBe(3);
    expect(s.lastKey).toEqual({ key: "L", t: 30, wrong: true });
  });

  it("Block: a Backspace after a wrong key releases the jam (an accepted key that is not wrong)", () => {
    let s = press(press(raceIn("block"), "L", 10), "x", 20);
    expect(selectTypedView(s)).toMatchObject({ jammed: true, cursor: 1 });
    s = press(s, "Backspace", 30);
    expect(selectTypedView(s)).toMatchObject({ jammed: false, cursor: 0 });
    expect(s.lastKey).toEqual({ key: "Backspace", t: 30, wrong: false });
    // at the start of the text the engine still takes it (a counted press): the jam releases too
    s = press(press(raceIn("block"), "x", 10), "Backspace", 20);
    expect(selectTypedView(s)).toMatchObject({ jammed: false, cursor: 0 });
    expect(errorsOf(s)).toBe(1);
  });

  it("lastKey is { key, t, wrong } after each key the engine takes, wrong exactly when its errors grew", () => {
    let s = raceIn("continue");
    expect(s.lastKey).toBeNull();
    const steps: [string, number, boolean][] = [
      ["L", 10, false],
      ["x", 20, true],
      ["Backspace", 30, false], // takes the slip back: errors shrink
      ["e", 40, false],
      ["É", 50, true],
    ];
    for (const [key, t, wrong] of steps) {
      const before = errorsOf(s)!;
      s = press(s, key, t);
      expect(s.lastKey, key).toEqual({ key, t, wrong });
      expect(errorsOf(s)! > before, key).toBe(wrong);
    }
    // a key the engine refuses (older than the last one) records nothing
    expect(press(s, "x", 5)).toBe(s);
    // a new race or a (re)connect starts over
    const again = reduceRace(s, {
      type: "countdown",
      payload: { v: PROTOCOL_VERSION, race: RACE },
    });
    expect(again.lastKey).toBeNull();
    expect(reduceRace(s, { type: "welcome", payload: welcome() }).lastKey).toBeNull();
    // a snapshot keeps it
    const snap: RaceEvent = {
      type: "snapshot",
      payload: { v: PROTOCOL_VERSION, t: 900, desks: [[1, 2, 2, 0, 0]], ranks: [1] },
    };
    expect(reduceRace(s, snap).lastKey).toBe(s.lastKey);
  });

  it("Continue with backspace off: a Backspace reaches the engine and changes nothing on the copy", () => {
    let s = press(raceIn("continue", false), "x", 10);
    expect(s.prediction?.settings).toEqual({ errorMode: "continue", backspace: false });
    const before = selectTypedView(s);
    s = press(s, "Backspace", 20);
    expect(s.prediction?.state.total).toBe(2);
    expect(s.lastKey).toEqual({ key: "Backspace", t: 20, wrong: false });
    const after = selectTypedView(s);
    expect(after.chars).toEqual(before.chars);
    expect(after.cursor).toBe(1);
    // nothing was typed: the struck char does not pop again
    expect(after.lastTypedAt).toBe(before.lastTypedAt);
  });

  it("only a key that types a char pops: a refused Block key keeps the stamp, a Backspace clears it", () => {
    let s = press(raceIn("block"), "L", 10);
    expect(selectTypedView(s).lastTypedAt).toBe(10);
    s = press(s, "x", 20);
    expect(selectTypedView(s).lastTypedAt).toBe(10);
    s = press(s, "Backspace", 30);
    expect(selectTypedView(s).lastTypedAt).toBeNull();
    s = press(s, "L", 40);
    expect(selectTypedView(s).lastTypedAt).toBe(40);
  });

  it("stays pure with lastKey", () => {
    const s = freeze(press(raceIn("block"), "x", 10));
    expect(() => press(s, "L", 20)).not.toThrow();
    expect(s.lastKey).toEqual({ key: "x", t: 10, wrong: true });
  });

  // Contract of #654 C1: the room's `settings` broadcast after the welcome replaces the settings, and the
  // next countdown builds the prediction from them.
  const BLOCK = { ...DEFAULT_RACE_SETTINGS, errorMode: "block" as const, backspace: true };
  const settingsEvent: RaceEvent = {
    type: "settings",
    payload: { v: PROTOCOL_VERSION, settings: BLOCK },
  };

  it("a settings event replaces settings and nothing else (#654 C1)", () => {
    const waiting = run({
      type: "welcome",
      payload: welcome({ settings: { ...DEFAULT_RACE_SETTINGS, errorMode: "continue" } }),
    });
    expect(reduceRace(waiting, settingsEvent)).toEqual({ ...waiting, settings: BLOCK });
  });

  it("settings after the welcome: Block applies at the countdown (#654 C1)", () => {
    let s = run(
      {
        type: "welcome",
        payload: welcome({ settings: { ...DEFAULT_RACE_SETTINGS, errorMode: "continue" } }),
      },
      settingsEvent,
      { type: "countdown", payload: { v: PROTOCOL_VERSION, race: RACE } },
      { type: "go" },
    );
    expect(s.prediction?.settings).toEqual({ errorMode: "block", backspace: true });
    s = press(s, "x", 10);
    expect(selectTypedView(s)).toMatchObject({ jammed: true, cursor: 0 });
  });
});
