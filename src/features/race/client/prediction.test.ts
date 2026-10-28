import { applyKeystroke, initialState, mulberry32, type PlayerState } from "@fifth-copy/engine";
import { MAX_LAG_MS } from "@fifth-copy/protocol";
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
  total: s.total,
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
    const r = p
      .markSent(2)
      .reconcile({ cursor: 1, correct: 1, errors: 0, status: "asleep", total: 1 }, 2);
    expect(r.state).toMatchObject({ cursor: 1, correct: 1, errors: 0, status: "asleep" });
    expect(r.state.typed).toEqual([null]);
    expect(r.unacked).toEqual([]);
  });

  it("ackedBy reads the exact count of sent keys from the server's total (#645)", () => {
    const ks = keys("Le r");
    const p = ks
      .reduce((q, k) => q.push(k), createPrediction({ text: TEXT, settings: CONTINUE }))
      .markSent(3);
    const at = 400;
    expect(p.ackedBy(progress(initialState()), at)).toBe(0);
    expect(p.ackedBy(progress(fold(ks.slice(0, 2))), at)).toBe(2);
    expect(p.ackedBy(progress(fold(ks.slice(0, 3))), at)).toBe(3);
    // a key not yet sent cannot be acked
    expect(p.ackedBy(progress(fold(ks)), at)).toBe(3);
    // a net-neutral pair (a key and its Backspace) repeats the four numbers; the total tells them apart
    const bs = [
      { t: 100, key: "L" },
      { t: 150, key: "Backspace" },
    ];
    const q = bs
      .reduce((x, k) => x.push(k), createPrediction({ text: TEXT, settings: CONTINUE }))
      .markSent(2);
    expect(q.ackedBy(progress(initialState()), at)).toBe(0);
    expect(q.ackedBy(progress(fold(bs.slice(0, 1))), at)).toBe(1);
    expect(q.ackedBy(progress(fold(bs)), at)).toBe(2);
    // a desk the server stopped (asleep, finished, ...) acks every sent key: the reconcile adopts it
    expect(p.ackedBy({ ...progress(initialState()), status: "asleep" }, at)).toBe(3);
  });

  it("ackedBy counts a sent key older than MAX_LAG_MS as acked even when the server never applied it", () => {
    const ks = keys("Le r", 100, 50); // t = 100, 150, 200, 250
    const p = ks
      .reduce((q, k) => q.push(k), createPrediction({ text: TEXT, settings: CONTINUE }))
      .markSent(4);
    const server = progress(fold(ks.slice(0, 1))); // the server dropped e, ␠ and r
    expect(p.ackedBy(server, 150 + MAX_LAG_MS - 1)).toBe(1);
    expect(p.ackedBy(server, 150 + MAX_LAG_MS)).toBe(2);
    expect(p.ackedBy(server, 250 + MAX_LAG_MS)).toBe(4);
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

// #645 C1: a snapshot carries the engine's `total`, so the ack is exact even when the four numbers
// repeat (a wrong key then Backspace); a sent key the server never applied (dropped by its budget or
// trace cap) is acked once it is older than MAX_LAG_MS, so the desk can never stay finished alone.
describe("exact ack, no stuck finish (#645 C1)", () => {
  // L e ␠ r e ç ⌫ x ⌫ ç u: near the end a wrong key, Backspace and the right key, then the finishing
  // key in its own last batch. After the second ç the four numbers repeat those after the first one.
  const ks: Keystroke[] = [
    ...keys("Le reç"),
    ...["Backspace", "x", "Backspace", "ç", "u"].map((key, i) => ({ t: 400 + i * 50, key })),
  ];
  const typedAll = () =>
    ks.reduce((q, k) => q.push(k), createPrediction({ text: TEXT, settings: CONTINUE }));

  it("the script repeats the four numbers: one key short equals an earlier prefix", () => {
    const short = fold(ks.slice(0, 10));
    const earlier = fold(ks.slice(0, 6));
    expect({ ...progress(short), total: 0 }).toEqual({ ...progress(earlier), total: 0 });
    expect(short.total).not.toBe(earlier.total);
    expect(fold(ks).status).toBe("finished");
  });

  it("the server one key short with a repeated state: the prediction is typing again within one snapshot of the key going stale", () => {
    let p = typedAll().markSent(10).markSent(1);
    expect(p.state.status).toBe("finished");
    const server = progress(fold(ks.slice(0, 10))); // the finishing key never lands
    const last = ks.at(-1)!.t;
    expect(p.ackedBy(server, last + 100)).toBe(10); // exact: not 6 (an earlier match), not 11
    let typingAgainAt: number | null = null;
    for (let at = last + 100; at <= last + MAX_LAG_MS + 1_000; at += 100) {
      p = p.reconcile(server, p.ackedBy(server, at));
      if (at >= last + MAX_LAG_MS) {
        // never finished while the server's desk types, once the key cannot be in flight any more
        expect(p.state.status).toBe("typing");
        expect(progress(p.state)).toEqual(server);
        expect(p.unacked).toEqual([]);
      }
      if (p.state.status === "typing" && typingAgainAt === null) typingAgainAt = at;
    }
    expect(typingAgainAt).not.toBeNull();
    expect(typingAgainAt!).toBeLessThan(last + MAX_LAG_MS + 100);
    // the desk can type again: the finishing key applies and is queued for the server
    const again = p.push({ t: last + MAX_LAG_MS + 1_100, key: "u" });
    expect(again).not.toBe(p);
    expect(again.state.status).toBe("finished");
    expect(again.unacked).toHaveLength(1);
  });

  it("the last batch only in flight: the exact ack keeps the finish and settles on the next snapshot", () => {
    let p = typedAll().markSent(10).markSent(1);
    const last = ks.at(-1)!.t;
    const shown = p.state;
    // the server has the first six keys only: its numbers equal those after ten, the ack stays at six
    const six = progress(fold(ks.slice(0, 6)));
    expect(p.ackedBy(six, last)).toBe(6);
    p = p.reconcile(six, p.ackedBy(six, last));
    expect(p.unacked).toHaveLength(5);
    expect(p.state).toBe(shown);
    const done = progress(fold(ks));
    p = p.reconcile(done, p.ackedBy(done, last + 100));
    expect(p.unacked).toEqual([]);
    expect(p.state).toBe(shown);
    expect(p.base.typed).toEqual(fold(ks).typed);
  });
});

/**
 * #645 C2 + C5: a seeded simulation of one desk against an in-order network. The typist types the
 * prediction's next char, a wrong key or Backspace; keys leave in batches of 1 to 64; each batch and
 * each snapshot (every 100 ms) travels 10-70 ms in order; the server applies every key it receives
 * with the engine (no key dropped). Returns what the run saw, for the assertions.
 */
function simulate(seed: number) {
  const rng = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const words = ["le", "reçu", "dossier", "tampon", "guichet", "formulaire", "copie", "à", "été"];
  const text = Array.from({ length: int(3, 9) }, () => words[int(0, words.length - 1)]).join(" ");
  const settings = seed % 2 === 0 ? CONTINUE : BLOCK;
  const pBackspace = rng() * 0.2;
  const pWrong = rng() * 0.15;
  const flushWait = int(0, 400);
  const apply = (s: PlayerState, k: Keystroke) => applyKeystroke(s, k, text, settings);
  const latency = () => int(10, 70);

  let p = createPrediction({ text, settings });
  let server = initialState();
  let pending: Keystroke[] = [];
  let target = int(1, 64);
  let sentKeys = 0;
  let pressed = 0;
  let lastBatchAt = 0;
  let lastSnapAt = 0;
  const batches: { at: number; keys: Keystroke[] }[] = [];
  const snaps: { at: number; t: number; state: PlayerState }[] = [];
  const problems: string[] = [];
  let nextKey = int(20, 150);
  let nextSnap = 100;
  let typing = true;
  let quietSnapTaken = false;
  let quiet = false;

  const flush = (now: number) => {
    if (pending.length === 0) return;
    lastBatchAt = Math.max(lastBatchAt, now + latency());
    batches.push({ at: lastBatchAt, keys: pending });
    p = p.markSent(pending.length);
    sentKeys += pending.length;
    pending = [];
    target = int(1, 64);
  };

  for (let guard = 0; guard < 100_000 && !quiet; guard++) {
    const now = Math.min(
      typing ? nextKey : Infinity,
      pending.length > 0 ? pending[0]!.t + flushWait : Infinity,
      batches[0]?.at ?? Infinity,
      nextSnap,
      snaps[0]?.at ?? Infinity,
    );
    // the server receives the batches due, in order, and applies every key
    while (batches[0] && batches[0].at <= now) {
      for (const k of batches.shift()!.keys) {
        if (server.status !== "typing") break;
        server = apply(server, k);
      }
    }
    if (nextSnap <= now) {
      lastSnapAt = Math.max(lastSnapAt, now + latency());
      snaps.push({ at: lastSnapAt, t: now, state: server });
      if (!typing && pending.length === 0 && batches.length === 0) quietSnapTaken = true;
      nextSnap += 100;
    }
    while (snaps[0] && snaps[0].at <= now) {
      const snap = snaps.shift()!;
      const sp = progress(snap.state);
      p = p.reconcile(sp, p.ackedBy(sp, snap.t));
      // C5 (and the exact ack behind it): after every snapshot the base is the server's own state,
      // typed record included, and the shown state is that state plus the keys still unacked
      const base = { ...progress(p.base), typed: p.base.typed };
      const want = { ...sp, typed: snap.state.typed };
      if (JSON.stringify(base) !== JSON.stringify(want)) {
        problems.push(`t=${snap.t} base ${JSON.stringify(base)} != server ${JSON.stringify(want)}`);
      }
      if (snap.state.total === sentKeys) {
        const shown = p.unacked.reduce(apply, snap.state);
        if (JSON.stringify(p.state.typed) !== JSON.stringify(shown.typed)) {
          problems.push(
            `t=${snap.t} typed ${JSON.stringify(p.state.typed)} != ${JSON.stringify(shown.typed)}`,
          );
        }
      }
      if (quietSnapTaken && snaps.length === 0) quiet = true;
    }
    if (typing && nextKey <= now) {
      const want = text[p.state.cursor];
      const r = rng();
      const key =
        r < pBackspace
          ? "Backspace"
          : r < pBackspace + pWrong || want === undefined
            ? want === "z"
              ? "q"
              : "z"
            : want;
      const k = { t: now, key };
      const q = p.push(k);
      pressed++;
      if (q !== p) pending.push(k);
      p = q;
      if (p.state.status !== "typing" || pressed >= 300) {
        typing = false;
        flush(now);
      } else if (pending.length >= target) flush(now);
      nextKey = now + int(20, 150);
    }
    if (pending.length > 0 && pending[0]!.t + flushWait <= now) flush(now);
  }
  return { p, server, problems, quiet, sentKeys, settings };
}

describe("exact ack under a simulated network (#645 C2, C5)", () => {
  it("1000 seeded runs: after quiescence the prediction equals the server, nothing unacked; typed records match after every snapshot", () => {
    const failures: string[] = [];
    let block = 0;
    let keysTotal = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const { p, server, problems, quiet, sentKeys, settings } = simulate(seed);
      if (settings.errorMode === "block") block++;
      keysTotal += sentKeys;
      const end = progress(p.state);
      if (!quiet) failures.push(`seed ${seed}: never quiet`);
      else if (JSON.stringify(end) !== JSON.stringify(progress(server))) {
        failures.push(
          `seed ${seed}: ${JSON.stringify(end)} != ${JSON.stringify(progress(server))}`,
        );
      }
      if (p.unacked.length !== 0 || p.sent !== 0) failures.push(`seed ${seed}: unacked left`);
      if (problems.length > 0) failures.push(`seed ${seed}: ${problems[0]}`);
    }
    expect(failures.slice(0, 5)).toEqual([]);
    expect(block).toBe(500);
    expect(keysTotal).toBeGreaterThan(20_000);
  });
});
