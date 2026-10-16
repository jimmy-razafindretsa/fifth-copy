import { applyKeystroke, initialState, type PlayerState } from "@fifth-copy/engine";
import { describe, expect, it, vi } from "vitest";
import { createPrediction, typedText, type Keystroke } from "./prediction";

// Contract of #559 C1: the local prediction is pure (no clock, no socket, no DOM). `push` applies a key
// through the engine and queues it; `reconcile(server, acked)` drops the acked keys and, when the
// server's state differs from the predicted base, re-applies the unacked keys on top of the server's.

const TEXT = "Le reçu";
const CONTINUE = { errorMode: "continue", backspace: true } as const;
const BLOCK = { errorMode: "block", backspace: true } as const;

const keys = (s: string, from = 100, step = 50): Keystroke[] =>
  Array.from(s).map((key, i) => ({ t: from + i * step, key }));
const fold = (ks: readonly Keystroke[], from = initialState(), settings = CONTINUE) =>
  ks.reduce((s, k) => applyKeystroke(s, k, TEXT, settings), from);
const progress = (s: PlayerState) => ({
  cursor: s.cursor,
  correct: s.correct,
  errors: s.errors,
  status: s.status,
});

/** Deep-freezes a value so code that mutates it throws. */
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) freeze(v);
  }
  return value;
}

describe("createPrediction (#559 C1)", () => {
  it("starts from the engine's initial state with nothing unacked", () => {
    const p = createPrediction({ text: TEXT, settings: CONTINUE, apply: applyKeystroke });
    expect(p.state).toEqual(initialState());
    expect(p.base).toEqual(initialState());
    expect(p.unacked).toEqual([]);
    expect(p.sent).toBe(0);
    expect(p.jammed).toBe(false);
    expect(p.text).toBe(TEXT);
  });

  it("push applies the key through the injected engine and appends it to the unacked queue", () => {
    const apply = vi.fn(applyKeystroke);
    const p0 = createPrediction({ text: TEXT, settings: CONTINUE, apply });
    const [l, e] = keys("Le");
    const p2 = p0.push(l!).push(e!);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 1 }),
      e,
      TEXT,
      CONTINUE,
    );
    expect(p2.state).toEqual(fold([l!, e!]));
    expect(p2.unacked).toEqual([l, e]);
    expect(p2.base).toEqual(initialState());
    // immutable values: the earlier prediction is unchanged
    expect(p0.state).toEqual(initialState());
    expect(p0.unacked).toEqual([]);
  });

  it("a key the engine refuses changes nothing (same prediction, nothing to send)", () => {
    const p = createPrediction({ text: "L", settings: CONTINUE }).push({ t: 10, key: "L" });
    expect(p.state.status).toBe("finished");
    expect(p.push({ t: 20, key: "x" })).toBe(p);
    // a key older than the last one is refused too
    const q = createPrediction({ text: TEXT, settings: CONTINUE }).push({ t: 500, key: "L" });
    expect(q.push({ t: 400, key: "e" })).toBe(q);
  });

  it("is pure: it never mutates its input, and the same keys give the same state", () => {
    const ks = freeze(keys("Le r"));
    const a = ks.reduce((p, k) => p.push(k), createPrediction({ text: TEXT, settings: CONTINUE }));
    const b = ks.reduce((p, k) => p.push(k), createPrediction({ text: TEXT, settings: CONTINUE }));
    expect(a.state).toEqual(b.state);
    const server = freeze(progress(fold(ks.slice(0, 2))));
    expect(() => a.markSent(4).reconcile(server, 2)).not.toThrow();
  });

  it("markSent counts the keys handed to the server, never more than are queued", () => {
    const p = keys("Le").reduce(
      (q, k) => q.push(k),
      createPrediction({ text: TEXT, settings: CONTINUE }),
    );
    expect(p.markSent(1).sent).toBe(1);
    expect(p.markSent(5).sent).toBe(2);
    expect(p.markSent(0)).toBe(p);
  });

  it("reconcile with the server equal to the predicted base drops the acked keys and keeps the view", () => {
    const ks = keys("Le r");
    const p = ks.reduce((q, k) => q.push(k), createPrediction({ text: TEXT, settings: CONTINUE }));
    const sent = p.markSent(4);
    const r = sent.reconcile(progress(fold(ks.slice(0, 3))), 3);
    expect(r.unacked).toEqual(ks.slice(3));
    expect(r.sent).toBe(1);
    expect(r.base).toEqual(fold(ks.slice(0, 3)));
    // the predicted state is the same object: nothing to re-render
    expect(r.state).toBe(p.state);
    // nothing acked and nothing different: the same prediction
    expect(sent.reconcile(progress(initialState()), 0)).toBe(sent);
  });

  it("a scripted divergence (the server rejects one key) converges to server state plus unacked keys", () => {
    const ks = keys("Le r"); // L e ␠ r
    const p = ks.reduce((q, k) => q.push(k), createPrediction({ text: TEXT, settings: CONTINUE }));
    // the server applied L and ␠ but rejected e (dropped by its budget); r is still in flight
    const server = fold([ks[0]!, ks[2]!]);
    const r = p.markSent(3).reconcile(server, 3);
    expect(r.base).toEqual(server);
    expect(r.unacked).toEqual([ks[3]]);
    expect(r.state).toEqual(fold([ks[3]!], server));
    expect(r.state).not.toEqual(p.state);
    // the next snapshot agrees with the prediction: it settles
    const settled = r.reconcile(fold([ks[3]!], server), 1);
    expect(settled.unacked).toEqual([]);
    expect(settled.state).toBe(r.state);
  });

  it("a divergence from the snapshot's four numbers keeps the typed record up to the server's cursor", () => {
    const ks = keys("Lx"); // x is wrong in Continue mode
    const p = ks.reduce((q, k) => q.push(k), createPrediction({ text: TEXT, settings: CONTINUE }));
    // the server only has L, and a status the client did not predict
    const r = p.markSent(2).reconcile({ cursor: 1, correct: 1, errors: 0, status: "asleep" }, 2);
    expect(r.state).toMatchObject({ cursor: 1, correct: 1, errors: 0, status: "asleep" });
    expect(r.state.typed).toEqual([null]);
    expect(r.unacked).toEqual([]);
  });

  it("ackedBy finds the largest prefix of the sent keys the server state matches", () => {
    const ks = keys("Le r");
    const p = ks
      .reduce((q, k) => q.push(k), createPrediction({ text: TEXT, settings: CONTINUE }))
      .markSent(3);
    expect(p.ackedBy(progress(initialState()))).toBe(0);
    expect(p.ackedBy(progress(fold(ks.slice(0, 2))))).toBe(2);
    expect(p.ackedBy(progress(fold(ks.slice(0, 3))))).toBe(3);
    // a key not yet sent cannot be acked: no match falls back to every sent key
    expect(p.ackedBy(progress(fold(ks)))).toBe(3);
    // a net-neutral pair (a key and its Backspace) matches the larger prefix
    const bs = [
      { t: 100, key: "L" },
      { t: 150, key: "Backspace" },
    ];
    const q = bs
      .reduce((x, k) => x.push(k), createPrediction({ text: TEXT, settings: CONTINUE }))
      .markSent(2);
    expect(q.ackedBy(progress(initialState()))).toBe(2);
  });

  it("Block mode: a wrong key holds the cursor and jams; the correct key releases it", () => {
    const p0 = createPrediction({ text: TEXT, settings: BLOCK });
    const wrong = p0.push({ t: 100, key: "x" });
    expect(wrong.state.cursor).toBe(0);
    expect(wrong.state.errors).toBe(1);
    expect(wrong.jammed).toBe(true);
    const again = wrong.push({ t: 150, key: "y" });
    expect(again.jammed).toBe(true);
    const right = again.push({ t: 200, key: "L" });
    expect(right.state.cursor).toBe(1);
    expect(right.jammed).toBe(false);
    // Continue mode never jams
    expect(
      createPrediction({ text: TEXT, settings: CONTINUE }).push({ t: 1, key: "x" }).jammed,
    ).toBe(false);
  });

  it("starts from a given state (a welcome mid-race)", () => {
    const from = fold(keys("Le"));
    const p = createPrediction({ text: TEXT, settings: CONTINUE, initial: from });
    expect(p.state).toBe(from);
    expect(p.base).toBe(from);
    expect(p.push({ t: 400, key: " " }).state.cursor).toBe(3);
  });

  it("typedText is the effective text: the base text with the desk's overlay (none when null)", () => {
    expect(typedText("un deux trois", null)).toBe("un deux trois");
    expect(typedText("un deux trois", { extra: ["quatre"], removed: [1] })).toBe("un trois quatre");
  });
});
