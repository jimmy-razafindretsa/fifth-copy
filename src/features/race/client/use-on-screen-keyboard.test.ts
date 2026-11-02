import { describe, expect, it } from "vitest";
import { watchOnScreenKeyboard, type OskEnv, type OskState } from "./use-on-screen-keyboard";

// #251 C1: the on-screen keyboard detection over a fake `visualViewport`, a fake clock and fake timers.

type Listener = (e: Event) => void;

function fakeWindow(innerHeight = 1024) {
  const docListeners = new Map<string, Set<Listener>>();
  const vvListeners = new Set<Listener>();
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let clock = 0;
  let nextId = 1;
  const vv = {
    height: innerHeight,
    addEventListener: (type: string, fn: Listener) => type === "resize" && vvListeners.add(fn),
    removeEventListener: (type: string, fn: Listener) =>
      type === "resize" && vvListeners.delete(fn),
  };
  const env = {
    document: {
      addEventListener: (type: string, fn: Listener) => {
        if (!docListeners.has(type)) docListeners.set(type, new Set());
        docListeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: Listener) => docListeners.get(type)?.delete(fn),
    },
    visualViewport: vv,
    innerHeight: () => innerHeight,
    now: () => clock,
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ at: clock + ms, fn, id });
      return id;
    },
    clearTimeout: (id: unknown) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  } as unknown as OskEnv;

  const element = (selector: string) => ({ matches: (s: string) => s === selector });
  return {
    env,
    /** Focuses an element matching `selector` (the race input is `[data-race-input]`). */
    focus(selector = "[data-race-input]") {
      const e = { target: element(selector) } as unknown as Event;
      for (const fn of docListeners.get("focusin") ?? []) fn(e);
    },
    /** The visual viewport takes `height`, as an on-screen keyboard or its closing would. */
    resize(height: number) {
      vv.height = height;
      for (const fn of vvListeners) fn({} as Event);
    },
    /** Lets `ms` pass, firing due timers. */
    advance(ms: number) {
      const end = clock + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const due = timers[0];
        if (!due || due.at > end) break;
        timers.shift();
        clock = due.at;
        due.fn();
      }
      clock = end;
    },
    listeners: () => (docListeners.get("focusin")?.size ?? 0) + vvListeners.size,
    pendingTimers: () => timers.length,
  };
}

function watch(w: ReturnType<typeof fakeWindow>) {
  const seen: OskState[] = [];
  const stop = watchOnScreenKeyboard(w.env, (s) => seen.push(s));
  return { seen, stop };
}

describe("watchOnScreenKeyboard (#251 C1)", () => {
  it("opens when the visual viewport drops below 70% of innerHeight within 300 ms of focusing the race input", () => {
    const w = fakeWindow(1024);
    const { seen } = watch(w);
    w.focus();
    w.advance(120);
    w.resize(460); // 45%
    expect(seen).toEqual(["open"]);
  });

  it("closes when the height recovers to 70% or more", () => {
    const w = fakeWindow(1024);
    const { seen } = watch(w);
    w.focus();
    w.resize(460);
    w.advance(5_000);
    w.resize(700); // 68%: still covered
    expect(seen).toEqual(["open"]);
    w.resize(1024);
    expect(seen).toEqual(["open", "closed"]);
  });

  it("counts a shrink that came before the focus event, read when the 300 ms window ends", () => {
    const w = fakeWindow(768);
    const { seen } = watch(w);
    w.focus();
    // the keyboard's resize races the focus; the viewport is already short but the event came first
    (w.env.visualViewport as { height: number }).height = 300;
    w.advance(300);
    expect(seen).toEqual(["open"]);
  });

  it("stays closed with a hardware keyboard: the viewport never shrinks", () => {
    const w = fakeWindow(1024);
    const { seen } = watch(w);
    w.focus();
    w.advance(1_000);
    expect(seen).toEqual([]);
  });

  it("ignores a shrink later than 300 ms after the focus", () => {
    const w = fakeWindow(1024);
    const { seen } = watch(w);
    w.focus();
    w.advance(301);
    w.resize(460);
    expect(seen).toEqual([]);
  });

  it("ignores a shrink of exactly 70% (the bound is strict)", () => {
    const w = fakeWindow(1000);
    const { seen } = watch(w);
    w.focus();
    w.resize(700);
    expect(seen).toEqual([]);
    w.resize(699);
    expect(seen).toEqual(["open"]);
  });

  it("ignores focus on anything but the race input", () => {
    const w = fakeWindow(1024);
    const { seen } = watch(w);
    w.focus("[data-abandon] button");
    w.resize(460);
    w.advance(1_000);
    expect(seen).toEqual([]);
  });

  it("measures against innerHeight at the focus, so a layout that shrinks with the keyboard still opens", () => {
    let inner = 1024;
    const w = fakeWindow(1024);
    w.env.innerHeight = () => inner;
    const { seen } = watch(w);
    w.focus();
    inner = 460; // Android's resizes-content shrinks innerHeight as well
    w.resize(460);
    expect(seen).toEqual(["open"]);
    inner = 1024;
    w.resize(1024);
    expect(seen).toEqual(["open", "closed"]);
  });

  it("reopens on the next focus", () => {
    const w = fakeWindow(1024);
    const { seen } = watch(w);
    w.focus();
    w.resize(460);
    w.resize(1024);
    w.advance(2_000);
    w.focus();
    w.resize(460);
    expect(seen).toEqual(["open", "closed", "open"]);
  });

  it("removes its listeners and timer on cleanup", () => {
    const w = fakeWindow(1024);
    const { seen, stop } = watch(w);
    w.focus();
    stop();
    expect(w.listeners()).toBe(0);
    expect(w.pendingTimers()).toBe(0);
    w.resize(460);
    expect(seen).toEqual([]);
  });

  it("does nothing without a visualViewport", () => {
    const w = fakeWindow(1024);
    const env = { ...w.env, visualViewport: null };
    const seen: OskState[] = [];
    const stop = watchOnScreenKeyboard(env, (s) => seen.push(s));
    expect(w.listeners()).toBe(0);
    stop();
  });
});
