import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  PLAYER_STATUS_CODES,
  PROTOCOL_VERSION,
  roomCodeSchema,
  type Member,
  type Snapshot,
  type Welcome,
} from "@fifth-copy/protocol";

// Contract of #225 C2: the live counters re-render at most 4 times per second while typing and once per
// snapshot for the place. The WPM leaf reads a sampler (`createWpmSampler`, a tiny external store on an
// injected clock) through `useSyncExternalStore`, so its re-renders are the sampler's notifications; the
// place reads two primitives of the race store, so it re-renders only when the place itself changes.
// `react` is the real one; only `useSyncExternalStore` is wrapped in a spy (the store.test.ts pattern).
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useSyncExternalStore: vi.fn(actual.useSyncExternalStore) };
});

const react = await import("react");
const { createRaceStore } = await import("../client/store");
const { RaceStoreProvider } = await import("../client/use-race-store");
const { selectWpm } = await import("../view/counters");
const { hudLabelFixtures } = await import("../view/hud-labels");
const {
  createRemainingSampler,
  createWpmSampler,
  NixieCountersLive,
  TIMER_SAMPLE_MS,
  WPM_SAMPLE_MS,
} = await import("./nixie-counters-live");
type RaceEvent = import("../client/store").RaceEvent;
type RaceStore = import("../client/store").RaceStore;

const SERVER_NOW = 1_767_225_600_000;
const SKEW = 1_500;
const T0 = SERVER_NOW + 3_000;
const TEXT = "the quick brown fox jumps over the lazy dog and keeps on running far away";

const member = (desk: number): Member => ({
  desk,
  name: `Typist-${desk}`,
  isHost: desk === 1,
  isBot: false,
  color: desk - 1,
  marker: "circle",
});
const welcome: Welcome = {
  v: PROTOCOL_VERSION,
  role: "player",
  you: 2,
  room: { code: roomCodeSchema.parse("KGB-4821"), phase: "waiting" },
  members: [member(1), member(2)],
  settings: DEFAULT_RACE_SETTINGS,
  race: null,
  state: null,
  overlay: null,
  resumeKey: null,
  serverNow: SERVER_NOW,
};
const RACE = {
  raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
  text: TEXT,
  language: "en" as const,
  wordCount: 15,
  t0: T0,
  timerS: DEFAULT_RACE_SETTINGS.timerS,
};
const typing = PLAYER_STATUS_CODES.typing;
const snapshot = (t: number, you: number): RaceEvent => ({
  type: "snapshot",
  payload: {
    v: PROTOCOL_VERSION,
    t,
    desks: [
      [1, 10, 10, 0, typing, 10],
      [2, you, you, 0, typing, you],
    ] as Snapshot["desks"],
    // you lead once past desk 1's cursor
    ranks: you > 10 ? [2, 1] : [1, 2],
  },
});

/** A device clock with timers (the store.test.ts `fakeTimer`), starting `SKEW` behind the server. */
function fakeTimer(start = SERVER_NOW - SKEW) {
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
    get now() {
      return now;
    },
    get pending() {
      return due.size;
    },
    /** The page's timers stall: the clock moves on and nothing fires (a heavy frame). */
    stall(ms: number) {
      now += ms;
    },
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const first = [...due].sort(([, a], [, b]) => a.at - b.at)[0];
        if (!first || first[1].at > until) break;
        due.delete(first[0]);
        now = Math.max(now, first[1].at);
        first[1].fn();
      }
      now = until;
    },
  };
}

/** A store seated, counting down and at GO on the fake clock. */
function racing(clock: ReturnType<typeof fakeTimer>, store: RaceStore = createRaceStore()) {
  store.dispatch({ type: "welcome", payload: welcome, receivedAt: clock.now });
  store.dispatch({ type: "countdown", payload: { v: PROTOCOL_VERSION, race: RACE } });
  clock.advance(T0 - SKEW - clock.now);
  store.dispatch({ type: "go" });
  return store;
}

/** Race time (ms since GO on the server clock) at the fake device clock. */
const raceT = (clock: ReturnType<typeof fakeTimer>) => clock.now + SKEW - T0;

/**
 * One second of typing: 40 keys (25 ms apart) and 10 snapshots (100 ms apart, `sent` before each, as
 * the key batcher does), the clock advancing between them. Returns how many keys were typed.
 */
function typeOneSecond(store: RaceStore, clock: ReturnType<typeof fakeTimer>, from = 0) {
  for (let i = 1; i <= 40; i++) {
    clock.advance(25);
    const n = from + i;
    store.dispatch({ type: "key", keystroke: { t: raceT(clock), key: TEXT[n - 1]! } });
    if (i % 4 === 0) {
      store.dispatch({ type: "sent", count: 4 });
      store.dispatch(snapshot(raceT(clock), n));
    }
  }
  return from + 40;
}

afterEach(() => vi.mocked(react.useSyncExternalStore).mockClear());

describe("createWpmSampler (#225 C2)", () => {
  it("does not tick before GO; reads the store's value on the corrected clock", () => {
    const clock = fakeTimer();
    const store = createRaceStore();
    const sampler = createWpmSampler(store, { timer: clock.timer });
    const seen = vi.fn();
    const off = sampler.subscribe(seen);
    store.dispatch({ type: "welcome", payload: welcome, receivedAt: clock.now });
    store.dispatch({ type: "countdown", payload: { v: PROTOCOL_VERSION, race: RACE } });
    clock.advance(2_000);
    expect(clock.pending).toBe(0);
    expect(seen).not.toHaveBeenCalled();
    expect(sampler.read()).toBe(0);
    off();
  });

  it("notifies at most 4 times in a second of typing with 10 snapshots, never on a keystroke", () => {
    const clock = fakeTimer();
    const store = racing(clock);
    const sampler = createWpmSampler(store, { timer: clock.timer });
    const seen = vi.fn();
    const off = sampler.subscribe(seen);
    expect(WPM_SAMPLE_MS).toBe(250);

    // a key alone never renders: the value waits for the next tick
    store.dispatch({ type: "key", keystroke: { t: raceT(clock) + 1, key: TEXT[0]! } });
    expect(seen).not.toHaveBeenCalled();

    const typed = typeOneSecond(store, clock, 1);
    expect(seen.mock.calls.length).toBeGreaterThan(0);
    expect(seen.mock.calls.length).toBeLessThanOrEqual(4);
    // one quiet period later the shown value is the engine's figure at the last tick (state + clock)
    const counted = seen.mock.calls.length;
    clock.advance(WPM_SAMPLE_MS);
    expect(seen.mock.calls.length - counted).toBeLessThanOrEqual(1);
    const now = clock.timer.now();
    const window = Array.from({ length: WPM_SAMPLE_MS }, (_, i) =>
      selectWpm(store.getState(), now - i),
    );
    expect(window).toContain(sampler.read());
    expect(sampler.read()).toBeGreaterThan(0);

    // and a second second: still at most 4
    seen.mockClear();
    typeOneSecond(store, clock, typed);
    expect(seen.mock.calls.length).toBeLessThanOrEqual(4);
    off();
  });

  it("a starved clock only delays the tick: the late sample reads the clock, not a count of ticks", () => {
    const clock = fakeTimer();
    const store = racing(clock);
    const sampler = createWpmSampler(store, { timer: clock.timer });
    const off = sampler.subscribe(() => {});
    const typed = typeOneSecond(store, clock);
    expect(typed).toBe(40);
    // the page's timers stalled for 3 s (a heavy frame): one late tick, the figure of the clock
    const shown = sampler.read();
    clock.stall(3_000);
    clock.advance(0);
    expect(sampler.read()).not.toBe(shown);
    expect(sampler.read()).toBe(selectWpm(store.getState(), clock.timer.now()));
    off();
  });

  it("stops ticking at your finishing key, with one final sample that then holds", () => {
    const clock = fakeTimer();
    const store = racing(clock);
    const sampler = createWpmSampler(store, { timer: clock.timer });
    const seen = vi.fn();
    const off = sampler.subscribe(seen);
    for (const ch of TEXT) {
      clock.advance(40);
      store.dispatch({ type: "key", keystroke: { t: raceT(clock), key: ch } });
    }
    const state = store.getState();
    expect(state.prediction!.state.status).toBe("finished");
    const final = selectWpm(state, clock.timer.now());
    expect(final).toBeGreaterThan(0);
    expect(sampler.read()).toBe(final);
    expect(clock.pending).toBe(0);
    seen.mockClear();
    clock.advance(60_000);
    store.dispatch({ type: "sent", count: TEXT.length });
    expect(seen).not.toHaveBeenCalled();
    expect(sampler.read()).toBe(final);
    off();
  });

  it("stops its clock when the last reader leaves", () => {
    const clock = fakeTimer();
    const store = racing(clock);
    const sampler = createWpmSampler(store, { timer: clock.timer });
    const a = sampler.subscribe(() => {});
    const b = sampler.subscribe(() => {});
    expect(clock.pending).toBe(1);
    a();
    expect(clock.pending).toBe(1);
    b();
    expect(clock.pending).toBe(0);
  });
});

describe("NixieCountersLive (#225 C2)", () => {
  const labels = hudLabelFixtures.en.nixie;

  function render(store: RaceStore) {
    const html = renderToStaticMarkup(
      createElement(RaceStoreProvider, { store }, createElement(NixieCountersLive, { labels })),
    );
    const calls = vi.mocked(react.useSyncExternalStore).mock.calls;
    return { html, calls };
  }

  it("renders the before-start counters on the server: 00 and 00 / n, no place yet", () => {
    const { html, calls } = render(createRaceStore());
    expect(html).toContain('aria-label="Words per minute 0, 0 typists, no place yet"');
    expect(html).toContain(">00<");
    expect(html).toContain("00 / 00");
    // the WPM and the timer (#240) from their samplers, the place and the total from the race store;
    // server snapshots read 0, the timer's null (no tube on the server)
    expect(calls).toHaveLength(4);
    expect(calls.map(([, , server]) => server!())).toEqual([0, null, 0, 0]);
    expect(html).not.toContain('data-tube="timer"');
  });

  it("the place re-renders at most once per snapshot: two primitives that keys never move", () => {
    const clock = fakeTimer();
    const store = racing(clock);
    const { calls } = render(store);
    const placeCalls = calls.filter(([subscribe]) => subscribe === store.subscribe);
    expect(placeCalls).toHaveLength(2);
    const [place, total] = placeCalls.map(([, read]) => read as () => number);
    expect(place!()).toBe(0);
    expect(total!()).toBe(2);

    // what React would see: one render per changed snapshot value (Object.is)
    let renders = 0;
    let last = [place!(), total!()];
    const off = store.subscribe(() => {
      const now = [place!(), total!()];
      if (!Object.is(now[0], last[0]) || !Object.is(now[1], last[1])) renders += 1;
      last = now;
    });
    typeOneSecond(store, clock); // 40 keys, 10 snapshots
    expect(renders).toBeGreaterThan(0);
    expect(renders).toBeLessThanOrEqual(10);
    expect(place!()).toBe(1);
    off();
  });

  it("a leaf mounted mid-race shows the current figure at once (the sampler starts from the store)", () => {
    const clock = fakeTimer();
    const store = racing(clock);
    typeOneSecond(store, clock);
    const sampler = createWpmSampler(store, { timer: clock.timer });
    expect(sampler.read()).toBe(selectWpm(store.getState(), clock.timer.now()));
    expect(sampler.read()).toBeGreaterThan(0);
  });
});

// #240 C1: the timer tube samples `selectRemaining` on the same bounded clock: it ticks from the
// countdown while a timer is set, never without one, and stops (frozen) once the server ends the race.
describe("createRemainingSampler (#240 C1)", () => {
  const timed = { ...welcome, settings: { ...DEFAULT_RACE_SETTINGS, timerS: 60 } };
  const timedRace = { ...RACE, timerS: 60 };

  it("counts down once a second on the corrected clock, and freezes at the race end", () => {
    const clock = fakeTimer();
    const store = createRaceStore();
    store.dispatch({ type: "welcome", payload: timed, receivedAt: clock.now });
    const sampler = createRemainingSampler(store, { timer: clock.timer });
    const seen: Array<number | null> = [];
    const off = sampler.subscribe(() => seen.push(sampler.read()));
    expect(sampler.read()).toBeNull();
    store.dispatch({ type: "countdown", payload: { v: PROTOCOL_VERSION, race: timedRace } });
    expect(sampler.read()).toBe(60);
    // GO is 3 s away on the server clock; then 2.5 s of race
    clock.advance(3_000);
    store.dispatch({ type: "go" });
    clock.advance(2_500);
    expect(sampler.read()).toBe(58);
    expect(seen).toEqual([60, 59, 58]);
    expect(clock.pending).toBe(1);
    store.dispatch({
      type: "ended",
      payload: { v: PROTOCOL_VERSION, raceId: RACE.raceId, reason: "all-finished", ranking: [] },
      at: clock.now,
    });
    expect(clock.pending).toBe(0);
    clock.stall(10_000);
    expect(sampler.read()).toBe(58);
    off();
    expect(TIMER_SAMPLE_MS).toBeLessThanOrEqual(250);
  });

  it("never ticks without a timer", () => {
    const clock = fakeTimer();
    const store = createRaceStore();
    store.dispatch({ type: "welcome", payload: welcome, receivedAt: clock.now });
    const sampler = createRemainingSampler(store, { timer: clock.timer });
    const off = sampler.subscribe(() => {});
    store.dispatch({ type: "countdown", payload: { v: PROTOCOL_VERSION, race: RACE } });
    store.dispatch({ type: "go" });
    expect(sampler.read()).toBeNull();
    expect(clock.pending).toBe(0);
    off();
  });
});
