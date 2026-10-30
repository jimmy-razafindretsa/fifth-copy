import { keysSchema, MAX_KEYS_PER_BATCH, PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { describe, expect, it, vi } from "vitest";
import { createKeyBatcher, KEY_BATCH_MS } from "./key-batcher";
import type { Keystroke } from "./prediction";

// Contract of #559 C2: keystrokes go to the race server in batches of at most 50 ms (ARCHITECTURE 7.2,
// 7.3), each a valid protocol `keys` payload; nothing leaves before GO or after the desk's finish.

/** A manual clock and timer: `now` is ms since GO; `advance` fires what falls due, in order. */
function fakeClock(start = 1_000) {
  let now = start;
  let next = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    timer: {
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
    set(t: number) {
      now = t;
    },
    pending: () => due.size,
  };
}

function setup(start?: number) {
  const clock = fakeClock(start);
  const sent: { at: number; batch: Keystroke[] }[] = [];
  const batcher = createKeyBatcher((batch) => sent.push({ at: clock.now(), batch }), {
    flushMs: 50,
    now: clock.now,
    timer: clock.timer,
  });
  const press = (key: string) => batcher.push({ t: clock.now(), key });
  return { clock, sent, batcher, press };
}

const valid = (batch: Keystroke[]) => keysSchema.safeParse({ v: PROTOCOL_VERSION, batch }).success;

describe("createKeyBatcher (#559 C2)", () => {
  it("defaults to 50 ms batches", () => {
    expect(KEY_BATCH_MS).toBe(50);
  });

  it("groups the keys of one burst into one batch", () => {
    const { clock, sent, press } = setup();
    press("L");
    press("e");
    press(" ");
    expect(sent).toEqual([]);
    clock.advance(0);
    expect(sent.map((s) => s.batch.map((k) => k.key))).toEqual([["L", "e", " "]]);
  });

  it("flushes at most every 50 ms: a key holds at most 50 ms, two flushes are 50 ms apart", () => {
    const { clock, sent, press } = setup();
    for (let i = 0; i < 20; i++) {
      press(String.fromCharCode(97 + i));
      clock.advance(10);
    }
    clock.advance(100);
    const at = sent.map((s) => s.at);
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(50);
    // every key left within 50 ms of its press, in order, exactly once
    const keys = sent.flatMap((s) => s.batch.map((k) => ({ ...k, at: s.at })));
    expect(keys.map((k) => k.key).join("")).toBe("abcdefghijklmnopqrst");
    for (const k of keys) expect(k.at - k.t).toBeLessThanOrEqual(50);
  });

  it("flush() sends what is queued at once and cancels the pending timer", () => {
    const { clock, sent, press, batcher } = setup();
    press("L");
    batcher.flush();
    expect(sent).toHaveLength(1);
    expect(clock.pending()).toBe(0);
    batcher.flush();
    expect(sent).toHaveLength(1);
  });

  it("every batch satisfies the protocol keys schema, split at the wire's 64 keys", () => {
    const { clock, sent, batcher } = setup();
    for (let i = 0; i < 150; i++) batcher.push({ t: clock.now(), key: "a" });
    clock.advance(0);
    expect(sent.map((s) => s.batch.length)).toEqual([MAX_KEYS_PER_BATCH, MAX_KEYS_PER_BATCH, 22]);
    for (const { batch } of sent) expect(valid(batch)).toBe(true);
  });

  it("refuses a keystroke the wire would refuse (not one printable character, a bad time)", () => {
    const { clock, sent, batcher } = setup();
    for (const k of [
      { t: clock.now(), key: "Shift" },
      { t: clock.now(), key: "" },
      { t: clock.now(), key: "\u0007" },
      { t: 1.5, key: "a" },
      { t: -1, key: "a" },
    ]) {
      expect(batcher.push(k), JSON.stringify(k)).toBe(false);
    }
    expect(batcher.push({ t: clock.now(), key: "Backspace" })).toBe(true);
    expect(batcher.push({ t: clock.now(), key: "é" })).toBe(true);
    clock.advance(0);
    expect(sent.map((s) => s.batch.map((k) => k.key))).toEqual([["Backspace", "é"]]);
    for (const { batch } of sent) expect(valid(batch)).toBe(true);
  });

  it("sends nothing before GO", () => {
    const { clock, sent, press } = setup(-500);
    expect(press("L")).toBe(false);
    clock.advance(1_000);
    expect(sent).toEqual([]);
  });

  it("sends nothing after the finish: close() flushes the finishing keys, then refuses", () => {
    const { clock, sent, press, batcher } = setup();
    press("L");
    press("e");
    batcher.close();
    expect(sent.map((s) => s.batch.map((k) => k.key))).toEqual([["L", "e"]]);
    expect(press(" ")).toBe(false);
    clock.advance(1_000);
    batcher.flush();
    expect(sent).toHaveLength(1);
  });

  it("copies the keystrokes it sends (a later change to the caller's object changes nothing)", () => {
    const send = vi.fn();
    const clock = fakeClock();
    const batcher = createKeyBatcher(send, { now: clock.now, timer: clock.timer });
    const k = { t: clock.now(), key: "L" };
    batcher.push(k);
    k.key = "x";
    batcher.flush();
    expect(send).toHaveBeenCalledWith([{ t: 1_000, key: "L" }]);
  });
});

// Contract of #695 C3: the embed shares the page's main thread (ADR 0017), so a heavy scene frame can hold
// the flush timer for hundreds of ms or more. `clock.set` moves time on without firing a timer: a starved
// timer queue. The next keystroke then sends what waits, at once.
describe("createKeyBatcher under a starved timer (#695 C3)", () => {
  it("a key whose flush is overdue leaves with the next keystroke, synchronously in push", () => {
    const { clock, sent, press } = setup();
    press("L");
    clock.set(1_600); // the 0 ms timer never ran
    expect(sent).toEqual([]);
    press("e");
    expect(sent).toEqual([
      {
        at: 1_600,
        batch: [
          { t: 1_000, key: "L" },
          { t: 1_600, key: "e" },
        ],
      },
    ]);
    // the stale timer is gone: nothing leaves twice
    clock.advance(1_000);
    expect(sent).toHaveLength(1);
    expect(clock.pending()).toBe(0);
  });

  it("keys within flushMs of the last flush still wait for the timer (at most one batch per flushMs)", () => {
    const { clock, sent, press } = setup();
    press("a");
    clock.set(1_600);
    press("b"); // overdue: leaves now (flush at 1600)
    clock.set(1_620);
    press("c"); // 20 ms after the flush: waits
    clock.set(1_640);
    press("d");
    expect(sent).toHaveLength(1);
    clock.advance(100);
    expect(sent.map((s) => [s.at, s.batch.map((k) => k.key).join("")])).toEqual([
      [1_600, "ab"],
      [1_650, "cd"],
    ]);
  });

  it("40 keys at 8 a second with a timer that never fires: no key waits past the next keystroke", () => {
    const { clock, sent, press } = setup();
    for (let i = 0; i < 40; i++) {
      press(String.fromCharCode(97 + (i % 26)));
      // every earlier key is out by now
      expect(sent.flatMap((s) => s.batch).length).toBeGreaterThanOrEqual(i);
      clock.set(clock.now() + 125);
    }
    const at = sent.map((s) => s.at);
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(50);
    expect(sent.flatMap((s) => s.batch)).toHaveLength(40);
    for (const { batch } of sent) expect(valid(batch)).toBe(true);
  });

  it("a timer on time keeps the #559 cadence: one burst is one batch on the next task", () => {
    const { clock, sent, press } = setup();
    press("a");
    press("b");
    press("c");
    expect(sent).toEqual([]);
    clock.advance(0);
    expect(sent).toHaveLength(1);
  });
});
