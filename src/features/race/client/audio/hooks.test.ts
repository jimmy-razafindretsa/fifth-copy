import { describe, expect, it } from "vitest";
import { bindSounds, type SoundSource } from "./hooks";

// #243 C3: one plain store subscription (no React) maps your keystroke to `clack`, a Block jam to `jam`,
// and a stamp shown (GO, overtake, passed, your finish) to `stamp`.

type State = SoundSource;
const base: State = { phase: "countdown", lastKey: null, prediction: null, stamps: [] };

function fakeStore(initial: State) {
  let state = initial;
  const listeners = new Set<() => void>();
  let subscribes = 0;
  return {
    getState: () => state,
    subscribe(l: () => void) {
      subscribes++;
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    set(patch: Partial<State>) {
      state = { ...state, ...patch };
      for (const l of [...listeners]) l();
    },
    get subscribes() {
      return subscribes;
    },
    get listeners() {
      return listeners.size;
    },
  };
}

function setup(initial: State = base) {
  const store = fakeStore(initial);
  const played: string[] = [];
  const off = bindSounds(store, { play: (name) => played.push(name) });
  return { store, played, off };
}

const key = (k: string, t: number, wrong = false) => ({ key: k, t, wrong });
const pred = (jammed: boolean) => ({ jammed });
const stamp = (id: number) => ({ id });

describe("#243 C3 bindSounds", () => {
  it("subscribes once and plays nothing for the state it starts from", () => {
    const { store, played } = setup({
      ...base,
      phase: "running",
      lastKey: key("a", 1),
      stamps: [stamp(4)],
    });
    expect(store.subscribes).toBe(1);
    expect(played).toEqual([]);
  });

  it("GO (countdown -> running) slams a stamp", () => {
    const { store, played } = setup();
    store.set({ phase: "running" });
    expect(played).toEqual(["stamp"]);
  });

  it("a reconnect that lands running plays nothing", () => {
    const { store, played } = setup({ ...base, phase: "reconnecting" });
    store.set({ phase: "running" });
    expect(played).toEqual([]);
  });

  it("each keystroke clacks, a wrong key in Continue too", () => {
    const { store, played } = setup({ ...base, phase: "running", prediction: pred(false) });
    store.set({ lastKey: key("a", 10) });
    store.set({ lastKey: key("a", 20) });
    store.set({ lastKey: key("q", 30, true) });
    expect(played).toEqual(["clack", "clack", "clack"]);
  });

  it("a key Block refused (the machine jams) plays the jam, each refused press again", () => {
    const { store, played } = setup({ ...base, phase: "running", prediction: pred(false) });
    store.set({ lastKey: key("q", 10, true), prediction: pred(true) });
    store.set({ lastKey: key("q", 20, true), prediction: pred(true) });
    store.set({ lastKey: key("a", 30), prediction: pred(false) });
    expect(played).toEqual(["jam", "jam", "clack"]);
  });

  it("a stamp shown (overtake, passed, finish, a pending one taking its turn) slams once", () => {
    const { store, played } = setup({ ...base, phase: "running" });
    store.set({ stamps: [stamp(1)] });
    store.set({ stamps: [stamp(1), stamp(2)] }); // queued, not shown yet
    store.set({ stamps: [stamp(2)] }); // the pending one shows
    store.set({ stamps: [] });
    expect(played).toEqual(["stamp", "stamp"]);
  });

  it("a snapshot that changes nothing it reads plays nothing; the unbind stops it", () => {
    const { store, played, off } = setup({ ...base, phase: "running", lastKey: key("a", 1) });
    store.set({});
    off();
    expect(store.listeners).toBe(0);
    store.set({ lastKey: key("b", 2) });
    expect(played).toEqual([]);
  });

  it("the cleared key of a new countdown plays nothing", () => {
    const { store, played } = setup({ ...base, phase: "ended", lastKey: key("a", 1) });
    store.set({ phase: "countdown", lastKey: null });
    expect(played).toEqual([]);
  });
});
