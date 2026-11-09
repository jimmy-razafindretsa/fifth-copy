import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COOLDOWN_MS, effectiveText, initialState } from "@fifth-copy/engine";
import {
  DEFAULT_RACE_SETTINGS,
  PLAYER_STATUS_CODES,
  PROTOCOL_VERSION,
  roomCodeSchema,
  type Countdown,
  type Ended,
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
  selectAbandonState,
  selectBonus,
  selectCanType,
  selectExit,
  selectTypedView,
  selectVisibleStamp,
  sendAbandons,
  sendBonusPlays,
  watchBlurExpiry,
  watchRefusalExpiry,
  watchStampExpiry,
  REFUSAL_SHOW_MS,
  PING_ROUND_COUNT,
  PING_ROUND_INTERVAL_MS,
} = await import("./store");
const { RaceStoreProvider, useRaceStore } = await import("./use-race-store");
const { connectToRoom } = await import("./socket");
const { selectClockPhase } = await import("../view/counters");
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
  bonus: null,
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
      // #232: the overtake stamps
      stamps: [],
      stampSeq: 0,
      // #240: the server's end
      ending: null,
      endedAt: null,
      // #236: your card, cooldown, blur and refusal
      bonus: {
        card: null,
        cooldownUntil: null,
        blurUntil: null,
        refused: false,
        refusedAt: null,
        pending: null,
        plays: 0,
      },
      // #233: your exit, the idle warning, the Major's lamp and the abandon intents sent
      exit: null,
      idleWarning: false,
      lampTarget: null,
      abandoning: false,
      abandons: 0,
      // #661 C2: no cut line waiting for its welcome
      keysHeld: false,
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

  // a `no-room` after a welcome is the lost room (#235 C4, below)
  it.each(["closed", "bad-token", "version", "in-progress"] as const)(
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
      // #661: the server's close and the transport drop
      "disconnect",
      "ended",
      "event",
      "pong",
      "rejected",
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
    clock.advance(2_400); // the welcome's ping round (#643) is over
    fake.deliver("countdown", countdown({ ...RACE, t0: clock.now + 3_000 }));
    fake.deliver("countdown", countdown({ ...RACE, t0: clock.now + 2_000 }));
    expect(clock.pending()).toBe(1);
    clock.advance(5_000);
    expect(gos()).toBe(1);
    // a welcome that no longer counts down (the race was voided) cancels the pending go
    fake.deliver("countdown", countdown({ ...RACE, t0: clock.now + 3_000 }));
    fake.deliver("welcome", welcome({ serverNow: clock.now }));
    clock.advance(2_400); // its ping round (#643); the go was cancelled, nothing else is due
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

  // Contract of #643 C3: after each welcome the binder sends 5 pings 600 ms apart on the injected timer
  // (inside the ADR 0020 ping budget of 2 a second),
  // sets the offset to the best pong of the round (`bestOffset`), reschedules a pending GO on it (still
  // one go) and its unbind cancels the pings still to send.
  describe("ping/pong refinement (#643 C3)", () => {
    const pings = (fake: ReturnType<typeof makeRoom>["fake"]) =>
      fake.emit.mock.calls.filter(([event]) => event === "ping").map(([, payload]) => payload);
    /** The server answers `sent` at `serverNow`; the pong reaches this device `after` ms later. */
    const answer = (
      fake: ReturnType<typeof makeRoom>["fake"],
      clock: ReturnType<typeof fakeTimer>,
      sent: number,
      serverNow: number,
      after = 0,
    ) => {
      clock.advance(after);
      fake.deliver("pong", { v: PROTOCOL_VERSION, sent, serverNow });
    };

    it("sends 5 pings 600 ms apart after a welcome, stamped with the injected clock", () => {
      const { fake, clock } = setup();
      const start = clock.now;
      fake.deliver("welcome", welcome({ serverNow: start }));
      expect(pings(fake)).toEqual([{ v: PROTOCOL_VERSION, sent: start }]);
      clock.advance(599);
      expect(pings(fake)).toHaveLength(1);
      clock.advance(1);
      expect(pings(fake)).toHaveLength(2);
      clock.advance(3_000);
      expect(pings(fake)).toEqual(
        [0, 600, 1_200, 1_800, 2_400].map((d) => ({ v: PROTOCOL_VERSION, sent: start + d })),
      );
      expect(clock.pending()).toBe(0);
      // never more than 2 pings in any 1 s window (ADR 0020)
      const sent = pings(fake).map((p) => (p as { sent: number }).sent);
      for (const at of sent)
        expect(sent.filter((t) => t > at - 1_000 && t <= at).length).toBeLessThanOrEqual(2);
    });

    it("the round ends inside the 3 s countdown and keeps the ADR 0020 budget", () => {
      expect(PING_ROUND_INTERVAL_MS * (PING_ROUND_COUNT - 1)).toBeLessThan(3_000);
      expect(PING_ROUND_INTERVAL_MS).toBeGreaterThanOrEqual(500);
    });

    it("sets the store's clock offset to the best pong of the round", () => {
      const { fake, room } = makeRoom();
      const clock = fakeTimer();
      const store = createRaceStore();
      bindRaceSocket(room, store.dispatch, { timer: clock.timer });
      const start = clock.now;
      // the welcome was 60 ms in flight: the welcome offset reads 500, the true offset is 560
      fake.deliver("welcome", welcome({ serverNow: start + 500 }));
      expect(store.getState().clockOffset).toBe(500);
      // ping 1: 200 ms round trip, answered half way -> 560
      answer(fake, clock, start, start + 100 + 560, 200);
      expect(store.getState().clockOffset).toBe(560);
      // ping 3 (sent at +1200): 20 ms round trip -> 560 + 4 (the server read late) = 564
      clock.advance(start + 1_200 - clock.now);
      answer(fake, clock, start + 1_200, start + 1_214 + 560, 20);
      expect(store.getState().clockOffset).toBe(564);
      // ping 4 (sent at +1800): 80 ms round trip, worse than 20: ignored
      clock.advance(start + 1_800 - clock.now);
      answer(fake, clock, start + 1_800, start + 1_800 + 900, 80);
      expect(store.getState().clockOffset).toBe(564);
      clock.advance(600);
      expect(pings(fake)).toHaveLength(5);
    });

    it("rounds the offset to whole milliseconds (the countdown steps on whole ms)", () => {
      const { fake, room } = makeRoom();
      const clock = fakeTimer();
      const store = createRaceStore();
      bindRaceSocket(room, store.dispatch, { timer: clock.timer });
      const start = clock.now;
      fake.deliver("welcome", welcome({ serverNow: start }));
      // 1 ms round trip: pongOffset = 100 - 0.5 = 99.5
      answer(fake, clock, start, start + 100, 1);
      expect(Number.isInteger(store.getState().clockOffset)).toBe(true);
      expect(store.getState().clockOffset).toBe(Math.round(99.5));
    });

    it("dispatches a clock event only when the best offset changes", () => {
      const { fake, clock, dispatch } = setup();
      const start = clock.now;
      fake.deliver("welcome", welcome({ serverNow: start }));
      answer(fake, clock, start, start + 20, 40);
      clock.advance(start + 600 - clock.now);
      answer(fake, clock, start + 600, start + 600 + 50, 100); // worse round trip
      const clocks = dispatch.mock.calls.map(([e]) => e).filter((e) => e.type === "clock");
      expect(clocks).toEqual([{ type: "clock", offset: 0 }]);
    });

    it("ignores a pong that answers no ping of the current round", () => {
      const { fake, clock, dispatch } = setup();
      const first = clock.now;
      fake.deliver("welcome", welcome({ serverNow: first }));
      clock.advance(3_000);
      // a second welcome (a reconnect) starts a new round: the first round's pongs are stale
      const second = clock.now;
      fake.deliver("welcome", welcome({ serverNow: second }));
      fake.deliver("pong", { v: PROTOCOL_VERSION, sent: first, serverNow: first + 9_999 });
      fake.deliver("pong", { v: PROTOCOL_VERSION, sent: second + 1, serverNow: second + 9_999 });
      expect(dispatch.mock.calls.some(([e]) => e.type === "clock")).toBe(false);
      answer(fake, clock, second, second + 300, 10);
      expect(dispatch.mock.calls.at(-1)![0]).toEqual({ type: "clock", offset: 295 });
    });

    it("a second welcome restarts the round: 5 more pings, the old ones cancelled", () => {
      const { fake, clock } = setup();
      const start = clock.now;
      fake.deliver("welcome", welcome({ serverNow: start }));
      clock.advance(650); // 2 pings sent, at +0 and +600
      fake.deliver("welcome", welcome({ serverNow: clock.now }));
      // the new round's first ping keeps 600 ms after the last one, not at once
      expect(pings(fake)).toHaveLength(2);
      clock.advance(549);
      expect(pings(fake)).toHaveLength(2);
      clock.advance(1);
      expect(pings(fake).at(-1)).toEqual({ v: PROTOCOL_VERSION, sent: start + 1_200 });
      clock.advance(5_000);
      expect(pings(fake)).toHaveLength(2 + 5);
      const sent = pings(fake).map((p) => (p as { sent: number }).sent);
      for (let i = 1; i < sent.length; i++) expect(sent[i]! - sent[i - 1]!).toBe(600);
    });

    it("reschedules a pending GO on the refined offset: still one go, now on time", () => {
      const { fake, clock, gos } = setup();
      const start = clock.now;
      // the welcome reads 500; the true offset is 560, so GO on the welcome offset would be 60 ms late
      fake.deliver("welcome", welcome({ serverNow: start + 500 }));
      const t0 = start + 560 + 3_000; // server clock: 3 s after the welcome left
      fake.deliver("countdown", countdown({ ...RACE, t0 }));
      answer(fake, clock, start, start + 10 + 560, 20);
      // GO now due at start + 3_000 on this device's clock
      clock.advance(start + 2_999 - clock.now);
      expect(gos()).toBe(0);
      clock.advance(1);
      expect(gos()).toBe(1);
      clock.advance(10_000);
      expect(gos()).toBe(1);
    });

    it("a pong without a pending GO schedules none", () => {
      const { fake, clock, gos } = setup();
      const start = clock.now;
      fake.deliver("welcome", welcome({ serverNow: start }));
      answer(fake, clock, start, start + 100, 20);
      clock.advance(10_000);
      expect(gos()).toBe(0);
      expect(clock.pending()).toBe(0);
    });

    it("the unbind cancels the pending pings and offs the pong listener", () => {
      const { fake, clock, unbind, dispatch } = setup();
      const start = clock.now;
      fake.deliver("welcome", welcome({ serverNow: start }));
      clock.advance(650);
      unbind();
      expect(clock.pending()).toBe(0);
      clock.advance(1_000);
      expect(pings(fake)).toHaveLength(2);
      fake.deliver("pong", { v: PROTOCOL_VERSION, sent: start, serverNow: start + 100 });
      expect(dispatch.mock.calls.some(([e]) => e.type === "clock")).toBe(false);
      expect(fake.listeners.get("pong")?.size ?? 0).toBe(0);
    });
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
    const ackedBy = vi.spyOn(s.prediction!, "ackedBy");
    const desks: Snapshot["desks"] = [
      [1, 4, 4, 0, typing, 4],
      [3, 0, 0, 0, typing, 0],
      [5, 1, 1, 0, typing, 1],
    ];
    const next = reduceRace(s, snapshot(desks, 500, [1, 5, 3]));
    expect(next.desks).toEqual(desks);
    expect(next.ranks).toEqual([1, 5, 3]);
    expect(reconcile).toHaveBeenCalledTimes(1);
    // the server's total and the snapshot's time reach the ack (#645)
    const server = { cursor: 1, correct: 1, errors: 0, status: "typing", total: 1 };
    expect(ackedBy).toHaveBeenCalledWith(server, 500);
    expect(reconcile).toHaveBeenCalledWith(server, 1);
    expect(next.prediction?.unacked).toEqual([]);
    // a snapshot without your desk (a spectator, or before your seat is in it) keeps desks only
    const other = reduceRace(s, snapshot([[1, 4, 4, 0, typing, 4]]));
    expect(other.prediction).toBe(s.prediction);
  });

  it("a diverging snapshot converges: the server's state plus the keys it has not seen", () => {
    // L, e sent; then ␠ typed and not yet sent
    let s = reduceRace(reduceRace(running(), key("L", 40)), key("e", 80));
    s = reduceRace(reduceRace(s, { type: "sent", count: 2 }), key(" ", 120));
    expect(s.prediction?.state.cursor).toBe(3);
    // the server counted one of the two sent keys wrong: no prefix of the prediction matches it
    s = reduceRace(s, snapshot([[5, 2, 1, 1, typing, 2]]));
    expect(s.prediction?.base).toMatchObject({ cursor: 2, correct: 1, errors: 1 });
    expect(s.prediction?.unacked).toEqual([{ t: 120, key: " " }]);
    expect(s.prediction?.state).toMatchObject({ cursor: 3, correct: 2, errors: 1 });
    // the next snapshot agrees: it settles with nothing left unacked
    s = reduceRace(reduceRace(s, { type: "sent", count: 1 }), snapshot([[5, 3, 2, 1, typing, 3]]));
    expect(s.prediction?.unacked).toEqual([]);
    expect(s.prediction?.state).toMatchObject({ cursor: 3, correct: 2, errors: 1 });
  });

  it("a status the server decided (asleep) locks typing", () => {
    const s = reduceRace(running(), snapshot([[5, 0, 0, 0, PLAYER_STATUS_CODES.asleep, 0]]));
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
    store.dispatch(snapshot([[5, 1, 1, 0, typing, 1]], 100));
    store.dispatch(snapshot([[5, 1, 1, 0, typing, 1]], 200));
    expect(views).toHaveLength(1);
    store.dispatch(key("e", 80));
    store.dispatch(key(" ", 120));
    expect(views).toHaveLength(3);
    // a rival's progress changes nothing on your sheet
    store.dispatch(
      snapshot(
        [
          [1, 3, 3, 0, typing, 3],
          [5, 1, 1, 0, typing, 1],
        ],
        300,
      ),
    );
    expect(views).toHaveLength(3);
    // the server diverges: exactly one new view
    store.dispatch({ type: "sent", count: 2 });
    store.dispatch(snapshot([[5, 2, 1, 1, typing, 2]], 400));
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
    const payload = freeze(snapshot([[5, 1, 1, 0, typing, 1]]));
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
    const payload: Snapshot = {
      v: PROTOCOL_VERSION,
      t: 100,
      desks: [[5, 1, 1, 0, 0, 1]],
      ranks: [5],
    };
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
      payload: { v: PROTOCOL_VERSION, t: 900, desks: [[1, 2, 2, 0, 0, 2]], ranks: [1] },
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

// Contract of #232 C1: the store's `event` case queues overtake stamps, one visible plus one pending;
// same-kind events within 300 ms collapse; a stamp expires 1.4 s after it shows (injected clock).
describe("#232 overtake stamps", () => {
  const T = 1_767_225_600_000;
  const overtake = (passed = 3, desk = 5) =>
    ({ v: PROTOCOL_VERSION, kind: "overtake", desk, passed }) as const;
  const passedBy = (by = 1, desk = 5) =>
    ({ v: PROTOCOL_VERSION, kind: "passed", desk, by }) as const;
  const ev = (
    payload: Extract<RaceEvent, { type: "event" }>["payload"],
    at: number,
  ): RaceEvent => ({
    type: "event",
    payload,
    at,
  });
  const RACE = {
    raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
    text: "Le reçu du café est prêt.",
    language: "fr" as const,
    wordCount: 5,
    t0: T + 3_000,
    timerS: DEFAULT_RACE_SETTINGS.timerS,
  };
  const seated = () => run({ type: "welcome", payload: welcome() });
  const view = (s: RaceState) =>
    s.stamps.map(({ id, kind, at, other }) => ({ id, kind, at, other }));

  /** A manual clock: `advance` fires what falls due, in order. */
  function clock(start = T) {
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
    };
  }

  it("an overtake or a passed of your desk queues { id, kind, at }; other desks and kinds do not", () => {
    let s = reduceRace(seated(), ev(overtake(3), T));
    expect(view(s)).toEqual([{ id: 1, kind: "overtake", at: T, other: 3 }]);
    expect(s.stamps[0]!.shownAt).toBe(T);
    s = reduceRace(s, ev(passedBy(1), T + 500));
    expect(view(s)).toEqual([
      { id: 1, kind: "overtake", at: T, other: 3 },
      { id: 2, kind: "passed", at: T + 500, other: 1 },
    ]);
    // the pending one shows when the visible one expires
    expect(s.stamps[1]!.shownAt).toBe(T + 1_400);
    // a spectator's copy of another desk's event, and kinds without a stamp, change nothing
    expect(reduceRace(s, ev(overtake(1, 3), T + 600))).toBe(s);
    const leader: RaceEvent = {
      type: "event",
      payload: { v: PROTOCOL_VERSION, kind: "new-leader", desk: 5 },
      at: T + 600,
    };
    expect(reduceRace(s, leader)).toBe(s);
    // a spectator (no desk) never stamps
    const spectator = run({ type: "welcome", payload: welcome({ role: "spectator", you: null }) });
    expect(reduceRace(spectator, ev(overtake(3), T))).toBe(spectator);
  });

  it("same-kind events within 300 ms collapse; 300 ms apart they queue", () => {
    const one = reduceRace(seated(), ev(overtake(3), T));
    expect(reduceRace(one, ev(overtake(1), T + 299))).toBe(one);
    const two = reduceRace(one, ev(overtake(1), T + 300));
    expect(view(two).map((x) => x.other)).toEqual([3, 1]);
    // another kind never collapses
    expect(view(reduceRace(one, ev(passedBy(1), T + 10))).map((x) => x.kind)).toEqual([
      "overtake",
      "passed",
    ]);
  });

  it("caps the queue at one visible plus one pending: the latest replaces the pending", () => {
    let s = seated();
    s = reduceRace(s, ev(overtake(3), T));
    s = reduceRace(s, ev(passedBy(3), T + 100));
    s = reduceRace(s, ev(overtake(1), T + 200));
    expect(view(s)).toEqual([
      { id: 1, kind: "overtake", at: T, other: 3 },
      { id: 3, kind: "overtake", at: T + 200, other: 1 },
    ]);
    // collapse compares with the newest queued stamp (the pending one)
    expect(reduceRace(s, ev(overtake(3), T + 350))).toBe(s);
  });

  it("a stamp expires 1.4 s after it shows; the pending one then shows for its own 1.4 s", () => {
    const c = clock();
    const store = createRaceStore(seated());
    const stop = watchStampExpiry(store, c.timer);
    store.dispatch(ev(overtake(3), T));
    c.advance(200);
    store.dispatch(ev(passedBy(1), T + 200));
    c.advance(1_199);
    expect(view(store.getState()).map((x) => x.id)).toEqual([1, 2]);
    c.advance(1);
    expect(view(store.getState()).map((x) => x.id)).toEqual([2]);
    expect(store.getState().stamps[0]!.shownAt).toBe(T + 1_400);
    c.advance(1_399);
    expect(store.getState().stamps).toHaveLength(1);
    c.advance(1);
    expect(store.getState().stamps).toEqual([]);
    expect(c.pending()).toBe(0);
    // after a quiet spell a new stamp shows at once and expires 1.4 s later
    c.advance(5_000);
    store.dispatch(ev(overtake(1), T + 7_800));
    expect(store.getState().stamps[0]!.shownAt).toBe(T + 7_800);
    stop();
    expect(c.pending()).toBe(0);
  });

  it("an expired visible stamp is dropped when the next event arrives, even before its timer", () => {
    let s = reduceRace(seated(), ev(overtake(3), T));
    s = reduceRace(s, ev(passedBy(1), T + 1_400));
    expect(view(s)).toEqual([{ id: 2, kind: "passed", at: T + 1_400, other: 1 }]);
    expect(s.stamps[0]!.shownAt).toBe(T + 1_400);
    // a stale expiry (not the visible stamp) changes nothing
    expect(reduceRace(s, { type: "stamp-expired", id: 1, at: T + 1_500 })).toBe(s);
  });

  it("welcome, countdown and a lost line clear the queue; ids stay unique", () => {
    const s = reduceRace(seated(), ev(overtake(3), T));
    const again = reduceRace(s, { type: "welcome", payload: welcome() });
    expect(again.stamps).toEqual([]);
    expect(reduceRace(again, ev(overtake(3), T + 10)).stamps[0]!.id).toBe(2);
    expect(
      reduceRace(s, { type: "countdown", payload: { v: PROTOCOL_VERSION, race: RACE } }).stamps,
    ).toEqual([]);
    expect(reduceRace(s, { type: "token-error", error: "closed" }).stamps).toEqual([]);
  });

  it("selectVisibleStamp returns the store's own object", () => {
    const s = reduceRace(seated(), ev(overtake(3), T));
    expect(selectVisibleStamp(s)).toBe(s.stamps[0]);
    expect(selectVisibleStamp(seated())).toBeNull();
  });

  it("bindRaceSocket turns a parsed `event` into a race event stamped with the device clock", () => {
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
    const io = vi.fn(() => fake) as unknown as IoFactory;
    const room = connectToRoom("http://localhost:7232", "tok", { io });
    const c = clock();
    const dispatch = vi.fn();
    bindRaceSocket(room, dispatch, { timer: c.timer });
    c.advance(42);
    for (const fn of listeners.get("event") ?? []) fn(overtake(3));
    // an invalid payload is dropped at the edge
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const fn of listeners.get("event") ?? []) fn({ v: PROTOCOL_VERSION, kind: "overtake" });
    expect(dispatch.mock.calls.map(([e]) => e)).toEqual([
      { type: "event", payload: overtake(3), at: T + 42 },
    ]);
  });
});

// Contract of #240 C3 (and the store half of C2): one reason-agnostic `ended` case sets phase `ended`
// with the server's ranking as sent and the device time it arrived; `welcome` and `countdown` reset it.
// The server's `finished` of your desk queues the finish stamp of bible 7.7 through the #232 queue.
describe("#240 ended and the finish stamp", () => {
  const T = 1_767_225_600_000;
  const RACE = {
    raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
    text: "ab cd",
    language: "en" as const,
    wordCount: 2,
    t0: T + 3_000,
    timerS: 60,
  };
  const entry = (place: number, desk: number, status: "finished" | "typing" | "asleep") => ({
    place,
    desk,
    name: `Lynx-${100 + desk}`,
    isBot: false,
    status,
    wpm: 52.4,
    rawWpm: 55,
    accuracy: 0.97,
    progress: status === "finished" ? 1 : 0.4,
    finishedAt: status === "finished" ? 12_000 : null,
  });
  const endedPayload = (
    reason: "all-finished" | "timer" | "void" = "timer",
    ranking: Ended["ranking"] = [entry(1, 2, "finished"), entry(2, 1, "typing")],
  ): Ended => ({ v: PROTOCOL_VERSION, raceId: RACE.raceId, reason, ranking });
  const countdown: RaceEvent = { type: "countdown", payload: { v: PROTOCOL_VERSION, race: RACE } };
  const running = () =>
    reduceRace(reduceRace(run({ type: "welcome", payload: welcome() }), countdown), {
      type: "go",
    });
  const ended = (payload = endedPayload(), at = T + 70_000): RaceEvent => ({
    type: "ended",
    payload,
    at,
  });
  const press = (s: RaceState, chars: string, from = 100) =>
    Array.from(chars).reduce(
      (acc, key, i) => reduceRace(acc, { type: "key", keystroke: { t: from + i * 100, key } }),
      s,
    );
  const finished = (desk = 5, place = 1): RaceEvent => ({
    type: "event",
    payload: { v: PROTOCOL_VERSION, kind: "finished", desk, place },
    at: T + 9_000,
  });

  // a `void` end is the lost room since #235 C4 (its own describe, below)
  it("sets phase ended with the server ranking as sent and the device time, for both ranked reasons", () => {
    const s = running();
    for (const reason of ["all-finished", "timer"] as const) {
      const payload = endedPayload(reason);
      const next = reduceRace(s, ended(payload, T + 61_000));
      expect(next.phase).toBe("ended");
      expect(next.room?.phase).toBe("ended");
      expect(next.ending).toBe(payload);
      expect(next.endedAt).toBe(T + 61_000);
      // nothing else is recomputed or dropped (ADR 0007): the prediction, the desks, the ranks stay
      expect(next.prediction).toBe(s.prediction);
      expect(next.ranks).toBe(s.ranks);
    }
    // a race ended with no finisher (every desk asleep) is still an end (the 2026-10-29 finding)
    const asleep = endedPayload("all-finished", [entry(1, 1, "asleep"), entry(2, 2, "asleep")]);
    expect(reduceRace(s, ended(asleep)).phase).toBe("ended");
  });

  it("locks typing, keeps the visible stamp, and is reset by countdown and welcome", () => {
    const s = reduceRace(running(), finished());
    expect(s.stamps).toHaveLength(1);
    const over = reduceRace(s, ended());
    expect(selectCanType(over)).toBe(false);
    expect(reduceRace(over, { type: "key", keystroke: { t: 9_000, key: "a" } })).toBe(over);
    expect(over.stamps).toBe(s.stamps);
    const again = reduceRace(over, countdown);
    expect(again).toMatchObject({ phase: "countdown", ending: null, endedAt: null });
    const reloaded = reduceRace(over, { type: "welcome", payload: welcome() });
    expect(reloaded).toMatchObject({ ending: null, endedAt: null });
    // GO never revives an ended race
    expect(reduceRace(over, { type: "go" })).toBe(over);
  });

  it("your desk's finished event queues ACCEPTED with zero errors, RETURNED with your error count", () => {
    const clean = reduceRace(press(running(), "ab cd"), finished());
    expect(clean.prediction!.state.status).toBe("finished");
    expect(clean.stamps.map(({ kind, other, errors }) => ({ kind, other, errors }))).toEqual([
      { kind: "accepted", other: 5, errors: 0 },
    ]);
    const sloppy = reduceRace(press(running(), "xb cdx"), finished());
    expect(sloppy.prediction!.state.errors).toBeGreaterThan(0);
    expect(sloppy.stamps.map(({ kind, errors }) => ({ kind, errors }))).toEqual([
      { kind: "returned", errors: sloppy.prediction!.state.errors },
    ]);
    // another desk's finish, and a spectator, stamp nothing
    const s = running();
    expect(reduceRace(s, finished(3, 1))).toBe(s);
    const spectator = run({ type: "welcome", payload: welcome({ role: "spectator", you: null }) });
    expect(reduceRace(spectator, finished())).toBe(spectator);
  });

  it("the finish stamp follows the #232 queue: it waits behind a visible overtake stamp", () => {
    let s = reduceRace(running(), {
      type: "event",
      payload: { v: PROTOCOL_VERSION, kind: "overtake", desk: 5, passed: 3 },
      at: T + 8_800,
    });
    s = reduceRace(s, finished());
    expect(s.stamps.map((x) => x.kind)).toEqual(["overtake", "accepted"]);
    expect(s.stamps[1]!.shownAt).toBe(T + 8_800 + 1_400);
  });

  it("bindRaceSocket turns a parsed `ended` into an ended event stamped with the device clock", () => {
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
    const io = vi.fn(() => fake) as unknown as IoFactory;
    const room = connectToRoom("http://localhost:7240", "tok", { io });
    const dispatch = vi.fn();
    const off = bindRaceSocket(room, dispatch, {
      timer: { now: () => T + 42, setTimeout: () => 0, clearTimeout: () => {} },
    });
    const payload = endedPayload();
    for (const fn of listeners.get("ended") ?? []) fn(payload);
    // an invalid payload is dropped at the edge
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const fn of listeners.get("ended") ?? []) fn({ v: PROTOCOL_VERSION, reason: "timer" });
    expect(dispatch.mock.calls.map(([e]) => e)).toEqual([{ type: "ended", payload, at: T + 42 }]);
    off();
    expect(listeners.get("ended")?.size ?? 0).toBe(0);
  });
});

// Contract of #236 C1: the server's bonus events map to `bonus = { card, cooldownUntil, overlay,
// blurUntil, refused }` for the viewer (snapshots carry no bonus field: protocol v7); a `bonus:play` goes
// out on Enter or the tray's button only while a card is held and not cooling (`COOLDOWN_MS` from the
// engine, the client decides nothing else); `refused` (set by `rejected { no-bonus }`) clears after 1.2 s.
describe("#236 bonus state", () => {
  const TEXT = "one two three four five six";
  const T0 = 1_767_225_603_000;
  const RACE = {
    raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
    text: TEXT,
    language: "en" as const,
    wordCount: 6,
    t0: T0,
    timerS: DEFAULT_RACE_SETTINGS.timerS,
  };
  const NOW = T0 + 2_000;
  const ev = (payload: Record<string, unknown>, at = NOW): RaceEvent =>
    ({ type: "event", payload: { v: PROTOCOL_VERSION, ...payload }, at }) as RaceEvent;
  const earned = (desk = 5, bonus = "extra-paperwork") => ev({ kind: "bonus-earned", desk, bonus });
  const sent = (from = 5, at = NOW, to = [1]) =>
    ev({ kind: "bonus-sent", from, to, bonus: "extra-paperwork" }, at);
  const hit = (over: Record<string, unknown> = {}, at = NOW) =>
    ev(
      {
        kind: "bonus-hit",
        desk: 5,
        bonus: "extra-paperwork",
        overlay: null,
        blurUntil: null,
        ...over,
      },
      at,
    );
  const rejected = (reason = "no-bonus", at = NOW): RaceEvent =>
    ({ type: "rejected", payload: { v: PROTOCOL_VERSION, reason }, at }) as RaceEvent;
  const play = (at = NOW): RaceEvent => ({ type: "bonus-play", at });
  const racing = (w = welcome()) =>
    run(
      { type: "welcome", payload: w },
      { type: "countdown", payload: { v: PROTOCOL_VERSION, race: RACE } },
      { type: "go" },
    );

  it("selectBonus reads { card, cooldownUntil, overlay, blurUntil, refused }, stable between changes", () => {
    const s = racing();
    expect(selectBonus(s)).toEqual({
      card: null,
      cooldownUntil: null,
      overlay: null,
      blurUntil: null,
      refused: false,
    });
    expect(selectBonus(s)).toBe(selectBonus(s));
    expect(selectBonus(reduceRace(s, { type: "key", keystroke: { t: 10, key: "o" } }))).toBe(
      selectBonus(s),
    );
  });

  it("a welcome mid-race seeds the overlay (welcome.overlay) and the prediction types it", () => {
    const overlay = { extra: ["memo"], removed: [] };
    const w = welcome({
      room: { code: roomCodeSchema.parse("KGB-4821"), phase: "running" },
      race: RACE,
      overlay,
    });
    const s = run({ type: "welcome", payload: w });
    expect(selectBonus(s).overlay).toEqual(overlay);
    expect(s.prediction?.text).toBe(effectiveText(TEXT, overlay));
    // the next race starts clean
    const next = reduceRace(s, { type: "countdown", payload: { v: PROTOCOL_VERSION, race: RACE } });
    expect(selectBonus(next).overlay).toBeNull();
    expect(next.prediction?.text).toBe(TEXT);
  });

  it("bonus-earned for your desk deals the card; another desk's changes nothing", () => {
    const s = racing();
    expect(reduceRace(s, earned(3))).toBe(s);
    const mine = reduceRace(s, earned(5, "smoke-break"));
    expect(selectBonus(mine).card).toBe("smoke-break");
    // a spectator holds nothing
    const spectator = racing(welcome({ role: "spectator", you: null }));
    expect(reduceRace(spectator, earned(5))).toBe(spectator);
  });

  it("a play goes out only while a card is held and not cooling; bonus-sent confirms the cooldown", () => {
    const s = racing();
    // no card: nothing
    expect(reduceRace(s, play())).toBe(s);
    const held = reduceRace(s, earned());
    const playing = reduceRace(held, play());
    expect(playing.bonus.plays).toBe(1);
    expect(selectBonus(playing).cooldownUntil).toBe(NOW + COOLDOWN_MS);
    // a second Enter while the first is in flight sends nothing
    expect(reduceRace(playing, play(NOW + 50))).toBe(playing);
    const confirmed = reduceRace(playing, sent(5, NOW + 80));
    expect(selectBonus(confirmed)).toMatchObject({
      card: null,
      cooldownUntil: NOW + 80 + COOLDOWN_MS,
    });
    expect(confirmed.bonus.pending).toBeNull();
    // another desk's play is not yours
    expect(reduceRace(playing, sent(3))).toBe(playing);
    // the next card arrives while cooling: no play until the cooldown is over
    const again = reduceRace(confirmed, earned());
    expect(reduceRace(again, play(NOW + 80 + COOLDOWN_MS - 1))).toBe(again);
    expect(reduceRace(again, play(NOW + 80 + COOLDOWN_MS)).bonus.plays).toBe(2);
  });

  it("no play before GO, after your finish, or with bonuses off", () => {
    const counting = run(
      { type: "welcome", payload: welcome() },
      { type: "countdown", payload: { v: PROTOCOL_VERSION, race: RACE } },
      earned(),
    );
    expect(reduceRace(counting, play())).toBe(counting);
    const off = reduceRace(
      racing(welcome({ settings: { ...DEFAULT_RACE_SETTINGS, bonuses: false } })),
      earned(),
    );
    expect(reduceRace(off, play())).toBe(off);
    const ended = reduceRace(reduceRace(racing(), earned()), {
      type: "ended",
      payload: { v: PROTOCOL_VERSION, raceId: RACE.raceId, reason: "all-finished", ranking: [] },
      at: NOW,
    });
    expect(reduceRace(ended, play())).toBe(ended);
  });

  it("rejected { no-bonus } while a card is held sets refused and rolls the optimistic cooldown back", () => {
    const held = reduceRace(racing(), earned());
    const playing = reduceRace(held, play());
    const refused = reduceRace(playing, rejected("no-bonus", NOW + 40));
    expect(selectBonus(refused)).toMatchObject({
      card: "extra-paperwork",
      cooldownUntil: null,
      refused: true,
    });
    expect(refused.bonus.refusedAt).toBe(NOW + 40);
    expect(refused.bonus.pending).toBeNull();
    // the card is kept: the player may try again at once (the server re-checks)
    expect(reduceRace(refused, play(NOW + 100)).bonus.plays).toBe(2);
    // other refusals and a no-bonus with nothing held change nothing
    expect(reduceRace(playing, rejected("rate-limit"))).toBe(playing);
    const empty = racing();
    expect(reduceRace(empty, rejected())).toBe(empty);
  });

  it("refused clears 1.2 s after it arrived (watchRefusalExpiry on the injected clock)", () => {
    expect(REFUSAL_SHOW_MS).toBe(1_200);
    let now = NOW;
    const timers: { at: number; fn: () => void }[] = [];
    const timer = {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => {
        const t = { at: now + ms, fn };
        timers.push(t);
        return t;
      },
      clearTimeout: (h: unknown) => void timers.splice(timers.indexOf(h as never), 1),
    };
    const advance = (ms: number) => {
      now += ms;
      for (const t of [...timers].sort((a, b) => a.at - b.at)) {
        if (t.at > now) continue;
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    };
    const store = createRaceStore(reduceRace(reduceRace(racing(), earned()), play()));
    const stop = watchRefusalExpiry(store, timer);
    store.dispatch(rejected("no-bonus", now));
    expect(selectBonus(store.getState()).refused).toBe(true);
    advance(REFUSAL_SHOW_MS - 1);
    expect(selectBonus(store.getState()).refused).toBe(true);
    advance(1);
    expect(selectBonus(store.getState()).refused).toBe(false);
    // a late expiry of an older refusal clears nothing
    store.dispatch(play(now));
    store.dispatch(rejected("no-bonus", now));
    const s = store.getState();
    expect(reduceRace(s, { type: "refusal-expired", refusedAt: now - 5_000 })).toBe(s);
    stop();
    expect(timers).toHaveLength(0);
  });

  it("bonus-hit on you: the overlay changes the prediction's text; a Smoke Break blurs until its end", () => {
    const s = reduceRace(racing(), { type: "key", keystroke: { t: 10, key: "o" } });
    const overlay = { extra: ["memo", "form"], removed: [] };
    const paper = reduceRace(s, hit({ overlay }));
    expect(selectBonus(paper).overlay).toEqual(overlay);
    expect(paper.prediction?.text).toBe(effectiveText(TEXT, overlay));
    expect(paper.prediction?.state).toBe(s.prediction?.state);
    expect(
      selectTypedView(paper)
        .chars.map((c) => c.ch)
        .join(""),
    ).toBe(`${TEXT} memo form`);
    // another desk's hit is not yours
    expect(reduceRace(s, hit({ desk: 3, overlay }))).toBe(s);
    // smoke break: no overlay change, the blur end on this device's clock (race ms + t0 - offset)
    const smoke = reduceRace(paper, hit({ bonus: "smoke-break", blurUntil: 7_000 }));
    expect(selectBonus(smoke).overlay).toEqual(overlay);
    expect(selectBonus(smoke).blurUntil).toBe(T0 + 7_000 - smoke.clockOffset);
    expect(selectTypedView(smoke).blurred).toBe(true);
    const clear = reduceRace(smoke, { type: "blur-expired", blurUntil: smoke.bonus.blurUntil! });
    expect(selectTypedView(clear).blurred).toBeUndefined();
    expect(reduceRace(smoke, { type: "blur-expired", blurUntil: 1 })).toBe(smoke);
  });

  it("watchBlurExpiry lifts the blur at blurUntil", () => {
    let now = T0;
    let pending: { at: number; fn: () => void } | null = null;
    const timer = {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => (pending = { at: now + ms, fn }),
      clearTimeout: () => void (pending = null),
    };
    const store = createRaceStore(racing());
    const stop = watchBlurExpiry(store, timer);
    store.dispatch(hit({ bonus: "smoke-break", blurUntil: 5_000 }));
    const until = store.getState().bonus.blurUntil!;
    expect(pending!.at).toBe(until);
    now = until;
    pending!.fn();
    expect(store.getState().bonus.blurUntil).toBeNull();
    stop();
  });

  it("a welcome without a bonus (no race running) resets the card, the cooldown and the blur", () => {
    const s = reduceRace(
      reduceRace(reduceRace(racing(), earned()), play()),
      hit({ bonus: "smoke-break", blurUntil: 5_000 }),
    );
    const back = reduceRace(s, { type: "welcome", payload: welcome() });
    expect(selectBonus(back)).toMatchObject({ card: null, cooldownUntil: null, blurUntil: null });
    // the play counter never goes back (the sender counts on it)
    expect(back.bonus.plays).toBe(1);
  });

  // #768 C2: a reconnect's welcome brings the desk's bonus back, race ms -> this device's clock
  describe("#768 C2 the welcome seeds the bonus", () => {
    const SERVER_NOW = T0 + 9_000;
    const RECEIVED_AT = SERVER_NOW - 250; // this device runs 250 ms behind the server
    const reload = (bonus: Welcome["bonus"]) =>
      reduceRace(initialRaceState, {
        type: "welcome",
        payload: welcome({
          room: { code: roomCodeSchema.parse("KGB-4821"), phase: "running" },
          race: RACE,
          state: { ...initialState(), typed: [] },
          bonus,
          serverNow: SERVER_NOW,
        }),
        receivedAt: RECEIVED_AT,
      });

    it("the card, the cooldown end and the blur end land on the device clock", () => {
      const s = reload({ card: "exemption", cooldownUntil: 20_000, blurUntil: 11_000 });
      expect(s.clockOffset).toBe(250);
      expect(s.bonus).toMatchObject({
        card: "exemption",
        cooldownUntil: T0 + 20_000 - 250,
        blurUntil: T0 + 11_000 - 250,
        refused: false,
        pending: null,
      });
      expect(selectBonus(s)).toMatchObject({ card: "exemption", blurUntil: T0 + 10_750 });
    });

    it("a reconnect of a page that held nothing seeds it; the play counter is kept", () => {
      const before = reduceRace(reduceRace(racing(), earned()), play());
      const back = reduceRace(before, {
        type: "welcome",
        payload: welcome({
          room: { code: roomCodeSchema.parse("KGB-4821"), phase: "running" },
          race: RACE,
          state: { ...initialState(), typed: [] },
          bonus: { card: "smoke-break", cooldownUntil: null, blurUntil: null },
          serverNow: SERVER_NOW,
        }),
        receivedAt: RECEIVED_AT,
      });
      expect(back.bonus).toMatchObject({ card: "smoke-break", cooldownUntil: null, pending: null });
      expect(back.bonus.plays).toBe(1);
    });

    it("the seeded cooldown gates a play until its end; a seeded card plays after", () => {
      const s = reload({ card: "extra-paperwork", cooldownUntil: 20_000, blurUntil: null });
      const end = s.bonus.cooldownUntil!;
      expect(reduceRace(s, play(end - 1)).bonus.plays).toBe(0);
      expect(reduceRace(s, play(end)).bonus.plays).toBe(1);
    });

    it("an all-null bonus or none leaves nothing held", () => {
      for (const bonus of [null, { card: null, cooldownUntil: null, blurUntil: null }]) {
        expect(reload(bonus).bonus).toMatchObject({
          card: null,
          cooldownUntil: null,
          blurUntil: null,
        });
      }
    });

    it("watchBlurExpiry lifts a seeded blur at its end", () => {
      let now = RECEIVED_AT;
      let pending: { at: number; fn: () => void } | null = null;
      const timer = {
        now: () => now,
        setTimeout: (fn: () => void, ms: number) => (pending = { at: now + ms, fn }),
        clearTimeout: () => void (pending = null),
      };
      const store = createRaceStore(reload({ card: null, cooldownUntil: null, blurUntil: 11_000 }));
      const stop = watchBlurExpiry(store, timer);
      const until = store.getState().bonus.blurUntil!;
      expect(pending!.at).toBe(until);
      now = until;
      pending!.fn();
      expect(store.getState().bonus.blurUntil).toBeNull();
      stop();
    });
  });

  it("sendBonusPlays emits one bonus:play per play the store took, and nothing for a refused Enter", () => {
    const store = createRaceStore(racing());
    const socket = { sendBonusPlay: vi.fn() };
    const stop = sendBonusPlays(store, socket);
    store.dispatch(play()); // no card
    expect(socket.sendBonusPlay).not.toHaveBeenCalled();
    store.dispatch(earned());
    store.dispatch(play());
    store.dispatch(play(NOW + 10)); // in flight
    expect(socket.sendBonusPlay).toHaveBeenCalledTimes(1);
    stop();
    store.dispatch(rejected());
    store.dispatch(play(NOW + 20));
    expect(socket.sendBonusPlay).toHaveBeenCalledTimes(1);
  });

  it("bindRaceSocket turns a parsed `rejected` into a race event stamped with the device clock", () => {
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
    const io = vi.fn(() => fake) as unknown as IoFactory;
    const room = connectToRoom("http://localhost:7236", "tok", { io });
    const dispatch = vi.fn();
    bindRaceSocket(room, dispatch, {
      timer: { now: () => 42, setTimeout: () => 0, clearTimeout: () => {} },
    });
    for (const fn of listeners.get("rejected") ?? [])
      fn({ v: PROTOCOL_VERSION, reason: "no-bonus" });
    expect(dispatch.mock.calls.map(([e]) => e)).toContainEqual({
      type: "rejected",
      payload: { v: PROTOCOL_VERSION, reason: "no-bonus" },
      at: 42,
    });
    room.sendBonusPlay();
    expect(fake.emit).toHaveBeenCalledWith("bonus:play", { v: PROTOCOL_VERSION });
  });
});

describe("#233 abandon, idle warning and asleep (C1)", () => {
  const TEXT = "one two three";
  const T0 = 1_767_225_603_000;
  const RACE = {
    raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
    text: TEXT,
    language: "en" as const,
    wordCount: 3,
    t0: T0,
    timerS: DEFAULT_RACE_SETTINGS.timerS,
  };
  const ev = (payload: Record<string, unknown>, at = T0 + 2_000): RaceEvent =>
    ({ type: "event", payload: { v: PROTOCOL_VERSION, ...payload }, at }) as RaceEvent;
  const key = (key: string, t: number): RaceEvent => ({ type: "key", keystroke: { t, key } });
  const countdown: RaceEvent = { type: "countdown", payload: { v: PROTOCOL_VERSION, race: RACE } };
  const racing = (w = welcome()) => run({ type: "welcome", payload: w }, countdown, { type: "go" });
  const abandon: RaceEvent = { type: "abandon" };
  const snapshot = (code: number, cursor = 2, t = 3_000): RaceEvent => ({
    type: "snapshot",
    payload: {
      v: PROTOCOL_VERSION,
      t,
      desks: [
        [5, cursor, cursor, 0, code, cursor],
        [1, 6, 6, 0, PLAYER_STATUS_CODES.typing, 6],
      ],
      ranks: [1, 5],
    },
  });

  it("takes the abandon intent once, only while you may type", () => {
    expect(reduceRace(run({ type: "welcome", payload: welcome() }), abandon).abandons).toBe(0);
    const counting = run({ type: "welcome", payload: welcome() }, countdown);
    expect(reduceRace(counting, abandon)).toBe(counting);
    const s = reduceRace(racing(), abandon);
    expect(s.abandons).toBe(1);
    expect(s.abandoning).toBe(true);
    expect(selectAbandonState(s)).toBe("disabled");
    // a second confirm while the first is in flight sends nothing
    expect(reduceRace(s, abandon)).toBe(s);
    expect(selectAbandonState(racing())).toBe("idle");
  });

  it("the server's `abandoned` for your desk locks typing and freezes the exit; other desks change nothing", () => {
    const typed = [key("o", 400), key("n", 800)].reduce(reduceRace, reduceRace(racing(), abandon));
    const other = reduceRace(typed, ev({ kind: "abandoned", desk: 1 }));
    expect(other.exit).toBeNull();
    const s = reduceRace(typed, ev({ kind: "abandoned", desk: 5 }));
    expect(s.exit).toEqual({ kind: "abandoned", dismissed: false });
    expect(s.phase).toBe("running");
    expect(selectCanType(s)).toBe(false);
    expect(selectExit(s)).toBe("abandoned");
    expect(selectAbandonState(s)).toBe("disabled");
    // a key after the exit is refused
    expect(reduceRace(s, key("e", 900))).toBe(s);
  });

  it("the server's `asleep` (the idle kick) for your desk sets the asleep exit", () => {
    const warned = reduceRace(racing(), ev({ kind: "idle-warning", desk: 5, kickAt: 60_000 }));
    const s = reduceRace(warned, ev({ kind: "asleep", desk: 5 }));
    expect(s.exit).toEqual({ kind: "asleep", dismissed: false });
    expect(selectExit(s)).toBe("asleep");
    expect(selectCanType(s)).toBe(false);
    // the warning is over once kicked
    expect(s.idleWarning).toBe(false);
    expect(s.lampTarget).toBeNull();
    expect(reduceRace(racing(), ev({ kind: "asleep", desk: 3 })).exit).toBeNull();
  });

  it("`idle-warning` for you turns the warning and the lamp on; your next accepted key clears both", () => {
    const base = racing();
    expect(reduceRace(base, ev({ kind: "idle-warning", desk: 3, kickAt: 60_000 }))).toBe(base);
    const s = reduceRace(base, ev({ kind: "idle-warning", desk: 5, kickAt: 60_000 }));
    expect(s.idleWarning).toBe(true);
    expect(s.lampTarget).toBe(5);
    const typed = reduceRace(s, key("o", 46_000));
    expect(typed.idleWarning).toBe(false);
    expect(typed.lampTarget).toBeNull();
  });

  it("a snapshot or a reload's welcome that carries your exit status sets it (the docket survives a reload)", () => {
    const viaSnapshot = reduceRace(racing(), snapshot(PLAYER_STATUS_CODES.abandoned));
    expect(viaSnapshot.exit).toEqual({ kind: "abandoned", dismissed: false });
    const reloaded = run({
      type: "welcome",
      payload: welcome({
        room: { code: roomCodeSchema.parse("KGB-4821"), phase: "running" },
        race: RACE,
        state: {
          cursor: 2,
          correct: 2,
          errors: 0,
          total: 2,
          typed: ["o", "n"],
          status: "asleep",
          lastT: 1_200,
          finishedAt: null,
        },
      }),
    });
    expect(selectExit(reloaded)).toBe("asleep");
    expect(selectCanType(reloaded)).toBe(false);
  });

  it("KEEP WATCHING dismisses the docket but keeps the exit (typing stays locked)", () => {
    const s = reduceRace(racing(), ev({ kind: "abandoned", desk: 5 }));
    const watching = reduceRace(s, { type: "exit-dismissed" });
    expect(watching.exit).toEqual({ kind: "abandoned", dismissed: true });
    expect(selectExit(watching)).toBeNull();
    expect(selectCanType(watching)).toBe(false);
    expect(reduceRace(watching, { type: "exit-dismissed" })).toBe(watching);
    expect(reduceRace(racing(), { type: "exit-dismissed" }).exit).toBeNull();
    // a later snapshot with the same status does not bring the docket back
    expect(selectExit(reduceRace(watching, snapshot(PLAYER_STATUS_CODES.abandoned)))).toBeNull();
  });

  it("a welcome or a new countdown resets the exit, the warning and the lamp; RACE OVER hides the docket", () => {
    const warned = reduceRace(racing(), ev({ kind: "idle-warning", desk: 5, kickAt: 60_000 }));
    const out = reduceRace(reduceRace(warned, abandon), ev({ kind: "abandoned", desk: 5 }));
    for (const next of [
      reduceRace(out, countdown),
      reduceRace(out, { type: "welcome", payload: welcome() }),
    ]) {
      expect(next.exit).toBeNull();
      expect(next.idleWarning).toBe(false);
      expect(next.lampTarget).toBeNull();
      expect(next.abandoning).toBe(false);
      // the sender's counter never goes back
      expect(next.abandons).toBe(1);
    }
    const ended = reduceRace(out, {
      type: "ended",
      payload: { v: PROTOCOL_VERSION, raceId: RACE.raceId, reason: "timer", ranking: [] },
      at: T0 + 60_000,
    } as RaceEvent);
    expect(selectExit(ended)).toBeNull();
    const endedWarned = reduceRace(warned, {
      type: "ended",
      payload: { v: PROTOCOL_VERSION, raceId: RACE.raceId, reason: "timer", ranking: [] },
      at: T0 + 60_000,
    } as RaceEvent);
    expect(endedWarned.idleWarning).toBe(false);
    expect(endedWarned.lampTarget).toBeNull();
  });

  it("a refused abandon (`not-running`) lets you confirm again", () => {
    const s = reduceRace(racing(), abandon);
    const refused = reduceRace(s, {
      type: "rejected",
      payload: { v: PROTOCOL_VERSION, reason: "not-running" },
      at: T0 + 2_000,
    } as RaceEvent);
    expect(refused.abandoning).toBe(false);
  });

  it("sendAbandons emits one abandon per intent the store took", () => {
    const store = createRaceStore(racing());
    const socket = { sendAbandon: vi.fn() };
    const stop = sendAbandons(store, socket);
    store.dispatch(abandon);
    store.dispatch(abandon); // in flight
    expect(socket.sendAbandon).toHaveBeenCalledTimes(1);
    stop();
    store.dispatch({
      type: "rejected",
      payload: { v: PROTOCOL_VERSION, reason: "not-running" },
      at: 1,
    } as RaceEvent);
    store.dispatch(abandon);
    expect(socket.sendAbandon).toHaveBeenCalledTimes(1);
  });
});

// Contract of #235 C1 and C4 (ARCHITECTURE 7.4: the race clock never pauses; ADR 0007: the server's state
// wins on the fresh welcome). A cut line keeps the race, your sheet, the GO instant and the settings;
// the reconnect's welcome reconciles your prediction onto the server's state of your desk; a voided
// race or a reconnect refused `no-room` is the lost room.
describe("#235 line cut, reconnect and the lost room", () => {
  const T = 1_767_225_600_000;
  const TEXT = "ab cd ef";
  const RACE = {
    raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
    text: TEXT,
    language: "en" as const,
    wordCount: 3,
    t0: T + 3_000,
    timerS: 60,
  };
  const code = roomCodeSchema.parse("KGB-4821");
  const countdown: RaceEvent = { type: "countdown", payload: { v: PROTOCOL_VERSION, race: RACE } };
  const running = () => run({ type: "welcome", payload: welcome() }, countdown, { type: "go" });
  const press = (s: RaceState, chars: string, from = 100) =>
    Array.from(chars).reduce(
      (acc, key, i) => reduceRace(acc, { type: "key", keystroke: { t: from + i * 100, key } }),
      s,
    );
  /** The server's state of your desk after `n` correct keys (the welcome's `state`). */
  const serverState = (n: number, lastT = 100 * n) => ({
    cursor: n,
    correct: n,
    errors: 0,
    total: n,
    typed: Array<null>(n).fill(null),
    status: "typing" as const,
    lastT,
    finishedAt: null,
  });
  const rewelcome = (n: number, over: Partial<Welcome> = {}): RaceEvent => ({
    type: "welcome",
    payload: welcome({
      room: { code, phase: "running" },
      race: RACE,
      state: serverState(n),
      ...over,
    }),
  });

  describe("C1 reconnecting keeps the race alive", () => {
    it("keeps the text, your prediction, GO and the settings; input is off; the race clock still runs", () => {
      const typed = press(running(), "ab ");
      const cut = reduceRace(typed, { type: "reconnecting" });
      expect(cut.phase).toBe("reconnecting");
      expect(cut.race).toBe(typed.race);
      expect(cut.prediction).toBe(typed.prediction);
      expect(cut.settings).toBe(typed.settings);
      expect(cut.room).toEqual({ code, phase: "running" });
      expect(selectTypedView(cut)).toBe(selectTypedView(typed));
      // the nixie and the timer read the room's phase: running (ARCHITECTURE 7.4)
      expect(selectClockPhase(cut)).toBe("running");
      expect(selectClockPhase(typed)).toBe("running");
      // input is disabled: no key is taken
      expect(selectCanType(cut)).toBe(false);
      expect(reduceRace(cut, { type: "key", keystroke: { t: 900, key: "c" } })).toBe(cut);
    });

    it("a cut during the countdown keeps the GO instant: the clock phase follows GO", () => {
      const counting = run({ type: "welcome", payload: welcome() }, countdown);
      const cut = reduceRace(counting, { type: "reconnecting" });
      expect(selectClockPhase(cut)).toBe("countdown");
      const gone = reduceRace(cut, { type: "go" });
      expect(gone.phase).toBe("reconnecting");
      expect(selectClockPhase(gone)).toBe("running");
      expect(gone.race).toBe(counting.race);
    });

    it("the binder keeps a pending GO across a reconnect attempt", () => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const emitter = () => ({
        on: (event: string, fn: (...args: unknown[]) => void) => {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(fn);
        },
        off: (event: string, fn: (...args: unknown[]) => void) => listeners.get(event)?.delete(fn),
      });
      const deliver = (event: string, ...args: unknown[]) => {
        for (const fn of [...(listeners.get(event) ?? [])]) fn(...args);
      };
      const fake = {
        ...emitter(),
        io: emitter(),
        emit: vi.fn(),
        disconnect: vi.fn(),
        connect: vi.fn(),
      };
      const room = connectToRoom("http://localhost:7235", "tok", {
        io: vi.fn(() => fake) as unknown as IoFactory,
      });
      let now = T;
      const due: { at: number; fn: () => void }[] = [];
      const timer = {
        now: () => now,
        setTimeout: (fn: () => void, ms: number) => due.push({ at: now + ms, fn }),
        clearTimeout: () => {},
      };
      const store = createRaceStore();
      bindRaceSocket(room, store.dispatch, { timer });
      deliver("welcome", welcome({ serverNow: T }));
      deliver("countdown", { v: PROTOCOL_VERSION, race: RACE });
      deliver("reconnect_attempt", 1);
      expect(store.getState().phase).toBe("reconnecting");
      now = RACE.t0;
      for (const d of due.splice(0).filter((d) => d.at <= now)) d.fn();
      expect(store.getState().room?.phase).toBe("running");
      expect(selectClockPhase(store.getState())).toBe("running");
    });

    it("the fresh welcome reconciles your prediction onto the server's state instead of resetting it", () => {
      const typed = reduceRace(press(running(), "ab "), { type: "sent", count: 3 });
      const back = reduceRace(reduceRace(typed, { type: "reconnecting" }), { type: "reconnected" });
      // the server applied the three keys: the shown state stands, same object, nothing re-renders
      const s = reduceRace(back, rewelcome(3));
      expect(s.phase).toBe("running");
      expect(s.prediction?.state).toBe(typed.prediction?.state);
      expect(s.prediction?.unacked).toEqual([]);
      expect(selectTypedView(s)).toBe(selectTypedView(typed));
      expect(s.lastKey).toEqual(typed.lastKey);
      expect(selectCanType(s)).toBe(true);
    });

    it("keys the server never got give way to its state; a key not yet sent is typed again on top", () => {
      // three keys sent, a fourth still in the 50 ms batch window at the cut
      const typed = press(
        reduceRace(press(running(), "ab "), { type: "sent", count: 3 }),
        "c",
        400,
      );
      const back = reduceRace(reduceRace(typed, { type: "reconnecting" }), { type: "reconnected" });
      // the server dropped the third key (its desk was cut): cursor 2
      const s = reduceRace(back, rewelcome(2));
      expect(s.prediction?.base.cursor).toBe(2);
      expect(s.prediction?.unacked).toEqual([{ t: 400, key: "c" }]);
      // "ab" then the unsent "c" where the space was: an error at 2, no reset to 0
      expect(s.prediction?.state).toMatchObject({ cursor: 3, errors: 1, total: 3 });
    });

    it("a welcome for another race, or for a spectator, still starts over from it", () => {
      const typed = press(running(), "ab ");
      const other = reduceRace(
        typed,
        rewelcome(1, { race: { ...RACE, raceId: "9b241101-e2bb-4255-8caf-4136c566a962" } }),
      );
      expect(other.prediction?.state.cursor).toBe(1);
      expect(other.lastKey).toBeNull();
      const watching = reduceRace(typed, rewelcome(1, { role: "spectator", you: null }));
      expect(watching.prediction).toBeNull();
    });
  });

  describe("C4 the lost room", () => {
    const voided: Ended = { v: PROTOCOL_VERSION, raceId: RACE.raceId, reason: "void", ranking: [] };

    it("ended { void } is lost with the room-lost reason", () => {
      const s = reduceRace(press(running(), "ab"), {
        type: "ended",
        payload: voided,
        at: T + 9_000,
      });
      expect(s).toMatchObject({ phase: "lost", lost: "room-lost" });
      expect(selectCanType(s)).toBe(false);
      // terminal, like any lost
      expect(reduceRace(s, rewelcome(2))).toBe(s);
    });

    // #661 C3: a voided race never leaves the page frozen on `running`, even when it arrives on a
    // cut line (the `ended` a reconnect's welcome is followed by, #204)
    it("#661 C3: ended { void } moves the store out of running, from running or reconnecting", () => {
      const live = running();
      expect(live.phase).toBe("running");
      const voidOf = (s: RaceState) => reduceRace(s, { type: "ended", payload: voided, at: T + 9_000 });
      for (const from of [live, reduceRace(live, { type: "disconnected" })]) {
        const s = voidOf(from);
        expect(s.phase).not.toBe("running");
        expect(s).toMatchObject({ phase: "lost", lost: "room-lost", keysHeld: from.keysHeld });
        expect(selectCanType(s)).toBe(false);
      }
    });

    it("an all-finished or timer end is still RACE OVER", () => {
      const over = reduceRace(running(), {
        type: "ended",
        payload: { ...voided, reason: "timer" },
        at: T + 63_000,
      });
      expect(over.phase).toBe("ended");
    });

    it("a reconnect answered no-room is the lost room; before any welcome it stays no-room", () => {
      const cut = reduceRace(running(), { type: "reconnecting" });
      expect(reduceRace(cut, { type: "connect-error", reason: "no-room" })).toMatchObject({
        phase: "lost",
        lost: "room-lost",
      });
      const waiting = run({ type: "welcome", payload: welcome() });
      expect(reduceRace(waiting, { type: "connect-error", reason: "no-room" })).toMatchObject({
        phase: "lost",
        lost: "room-lost",
        members: waiting.members,
      });
      expect(run({ type: "connect-error", reason: "no-room" })).toMatchObject({
        phase: "lost",
        lost: "no-room",
      });
    });
  });
});
