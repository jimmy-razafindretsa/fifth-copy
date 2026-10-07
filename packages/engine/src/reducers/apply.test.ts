import { describe, expect, it } from "vitest";
import { mulberry32, pick, pickInt } from "../testing/rng";
import { normalizeTypeable } from "../text/normalize";
import type { EngineSettings, ErrorMode, Keystroke } from "../types";
import { applyKeystroke } from "./apply";
import { initialState, type PlayerState } from "./state";

const CONTINUE: EngineSettings = { errorMode: "continue", backspace: true };
const CONTINUE_NO_BS: EngineSettings = { errorMode: "continue", backspace: false };
const BLOCK: EngineSettings = { errorMode: "block", backspace: true };
const BLOCK_NO_BS: EngineSettings = { errorMode: "block", backspace: false };

/** Keys typed 10 ms apart, starting at t = 10. */
function keys(...ks: string[]): Keystroke[] {
  return ks.map((key, i) => ({ t: (i + 1) * 10, key }));
}

function run(text: string, settings: EngineSettings, trace: Keystroke[], from = initialState()) {
  return trace.reduce((s, k) => applyKeystroke(s, k, text, settings), from);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

describe("initialState", () => {
  it("starts typing at zero and is JSON-serialisable", () => {
    const s = initialState();
    expect(s).toEqual({
      cursor: 0,
      correct: 0,
      errors: 0,
      total: 0,
      typed: [],
      status: "typing",
      lastT: 0,
      finishedAt: null,
    });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe("Continue mode (C3)", () => {
  it("bonjour against bonjour finishes with 7 correct", () => {
    const s = run("bonjour", CONTINUE, keys(..."bonjour"));
    expect(s).toMatchObject({ cursor: 7, correct: 7, errors: 0, total: 7, status: "finished" });
    expect(s.finishedAt).toBe(70);
    expect(s.typed).toEqual([null, null, null, null, null, null, null]);
  });

  it("bxnjour advances past the wrong key, records it and finishes", () => {
    const s = run("bonjour", CONTINUE, keys(..."bxnjour"));
    expect(s).toMatchObject({ cursor: 7, correct: 6, errors: 1, total: 7, status: "finished" });
    expect(s.typed[1]).toBe("x");
  });

  it("a composed e + U+0301 key counts as correct against é", () => {
    const text = normalizeTypeable("café");
    const s = run(text, CONTINUE, keys("c", "a", "f", "e\u0301"));
    expect(s).toMatchObject({ cursor: 4, correct: 4, errors: 0, status: "finished" });
  });

  it("a key that normalises to several characters is one wrong press", () => {
    const s = run("a.", CONTINUE, keys("…"));
    expect(s).toMatchObject({ cursor: 1, correct: 0, errors: 1, total: 1 });
    expect(s.typed).toEqual(["..."]);
  });

  it("a wrong last character still finishes (no stuck player when backspace is off)", () => {
    const s = run("ab", CONTINUE_NO_BS, keys("a", "x"));
    expect(s).toMatchObject({
      cursor: 2,
      correct: 1,
      errors: 1,
      status: "finished",
      finishedAt: 20,
    });
  });

  it("keeps typed.length === cursor", () => {
    const s = run("bonjour", CONTINUE, keys(..."bxn"));
    expect(s.typed).toEqual([null, "x", null]);
    expect(s.typed).toHaveLength(s.cursor);
  });
});

describe("Block mode (C4)", () => {
  it("a wrong key leaves the cursor in place and counts an error", () => {
    const s = run("bonjour", BLOCK, keys("x"));
    expect(s).toMatchObject({ cursor: 0, correct: 0, errors: 1, total: 1, status: "typing" });
    expect(s.typed).toEqual([]);
  });

  it("three wrong keys then the right one give cursor 1, errors 3, correct 1", () => {
    const s = run("bonjour", BLOCK, keys("x", "y", "z", "b"));
    expect(s).toMatchObject({ cursor: 1, errors: 3, correct: 1, total: 4 });
    expect(s.typed).toEqual([null]);
  });

  it("never finishes through a wrong key", () => {
    const before = run("ab", BLOCK, keys("a"));
    const s = run(
      "ab",
      BLOCK,
      [
        { t: 20, key: "x" },
        { t: 30, key: "y" },
      ],
      before,
    );
    expect(s).toMatchObject({ cursor: 1, status: "typing", finishedAt: null, errors: 2 });
    const done = applyKeystroke(s, { t: 40, key: "b" }, "ab", BLOCK);
    expect(done).toMatchObject({ cursor: 2, status: "finished", finishedAt: 40 });
  });
});

describe("Backspace (C5)", () => {
  it.each([["continue"], ["block"]] as const)(
    "%s with backspace on: moves back and undoes a correct character",
    (mode) => {
      const settings: EngineSettings = { errorMode: mode, backspace: true };
      const s = run("bonjour", settings, keys("b", "o", "Backspace"));
      expect(s).toMatchObject({ cursor: 1, correct: 1, errors: 0, total: 3 });
      expect(s.typed).toEqual([null]);
    },
  );

  it("continue with backspace on: undoes an error and clears the overstrike", () => {
    const s = run("bonjour", CONTINUE, keys("b", "x", "Backspace"));
    expect(s).toMatchObject({ cursor: 1, correct: 1, errors: 0, total: 3 });
    expect(s.typed).toEqual([null]);
    const fixed = applyKeystroke(s, { t: 40, key: "o" }, "bonjour", CONTINUE);
    expect(fixed).toMatchObject({ cursor: 2, correct: 2, errors: 0, total: 4 });
  });

  it("block with backspace on: wrong presses stay counted, the correct char is undone", () => {
    const s = run("bonjour", BLOCK, keys("b", "x", "Backspace"));
    expect(s).toMatchObject({ cursor: 0, correct: 0, errors: 1, total: 3 });
    expect(s.typed).toEqual([]);
  });

  it.each([["continue"], ["block"]] as const)(
    "%s with backspace off: cursor stays, only total grows",
    (mode) => {
      const settings: EngineSettings = { errorMode: mode, backspace: false };
      const before = run("bonjour", settings, keys("b", "o"));
      const s = applyKeystroke(before, { t: 30, key: "Backspace" }, "bonjour", settings);
      expect(s).toEqual({ ...before, total: before.total + 1, lastT: 30 });
    },
  );

  it.each([[CONTINUE], [BLOCK], [CONTINUE_NO_BS], [BLOCK_NO_BS]])(
    "at cursor 0 nothing but total (and lastT) changes (%o)",
    (settings) => {
      const s = applyKeystroke(initialState(), { t: 5, key: "Backspace" }, "bonjour", settings);
      expect(s).toEqual({ ...initialState(), total: 1, lastT: 5 });
    },
  );
});

describe("rejections return the same reference", () => {
  it("keystroke older than lastT", () => {
    const s = run("bonjour", CONTINUE, keys("b", "o"));
    expect(applyKeystroke(s, { t: 15, key: "n" }, "bonjour", CONTINUE)).toBe(s);
  });

  it("keystroke on a finished state", () => {
    const s = run("ab", CONTINUE, keys("a", "b"));
    expect(s.status).toBe("finished");
    expect(applyKeystroke(s, { t: 99, key: "c" }, "ab", CONTINUE)).toBe(s);
    expect(applyKeystroke(s, { t: 99, key: "Backspace" }, "ab", CONTINUE)).toBe(s);
  });

  it("keystroke on any other non-typing status", () => {
    const s: PlayerState = { ...initialState(), status: "abandoned" };
    expect(applyKeystroke(s, { t: 1, key: "b" }, "bonjour", BLOCK)).toBe(s);
  });

  it("a key that normalises to nothing (control character)", () => {
    const s = run("bonjour", CONTINUE, keys("b"));
    expect(applyKeystroke(s, { t: 20, key: "\u0007" }, "bonjour", CONTINUE)).toBe(s);
  });

  it("any keystroke against an empty text", () => {
    const s = initialState();
    expect(applyKeystroke(s, { t: 1, key: "a" }, "", CONTINUE)).toBe(s);
  });

  it("an equal t is accepted", () => {
    const s = run("bonjour", CONTINUE, keys("b"));
    expect(applyKeystroke(s, { t: 10, key: "o" }, "bonjour", CONTINUE).cursor).toBe(2);
  });
});

describe("invariants (C6, 500 seeded random traces each)", () => {
  const TEXTS = [
    "bonjour",
    "l'été arrive",
    "Quoi ? Déjà !",
    "a",
    "The quick brown fox.",
    "cœur",
  ].map(normalizeTypeable);
  const MODES: ErrorMode[] = ["continue", "block"];

  type Trace = { text: string; settings: EngineSettings; trace: Keystroke[] };

  function randomTrace(rng: () => number): Trace {
    const text = pick(rng, TEXTS);
    const settings = { errorMode: pick(rng, MODES), backspace: rng() < 0.5 };
    const alphabet = [...new Set([...text, "x", "Z", " ", "Backspace", "Backspace", "\u0007"])];
    const trace: Keystroke[] = [];
    let t = 0;
    const len = pickInt(rng, 3 * text.length + 4);
    for (let i = 0; i < len; i++) {
      // Mostly the expected-ish keys, sometimes out of order in time.
      t += rng() < 0.1 ? -pickInt(rng, 30) : pickInt(rng, 120);
      trace.push({
        t,
        key: rng() < 0.5 ? (text[pickInt(rng, text.length)] ?? "x") : pick(rng, alphabet),
      });
    }
    return { text, settings, trace };
  }

  function forTraces(seed: number, check: (tr: Trace) => void) {
    const rng = mulberry32(seed);
    for (let i = 0; i < 500; i++) check(randomTrace(rng));
  }

  it("cursor never decreases except on a Backspace keystroke; typed.length === cursor", () => {
    forTraces(1, ({ text, settings, trace }) => {
      let s = initialState();
      for (const k of trace) {
        const next = applyKeystroke(s, k, text, settings);
        if (k.key !== "Backspace") expect(next.cursor).toBeGreaterThanOrEqual(s.cursor);
        expect(next.typed).toHaveLength(next.cursor);
        expect(next.cursor).toBeLessThanOrEqual(text.length);
        s = next;
      }
    });
  });

  it("correct + errors equals the accepted non-backspace presses (net of presses undone by backspace)", () => {
    forTraces(2, ({ text, settings, trace }) => {
      let s = initialState();
      let pressed = 0;
      let undone = 0;
      let accepted = 0;
      for (const k of trace) {
        const next = applyKeystroke(s, k, text, settings);
        if (next !== s) {
          accepted++;
          if (k.key !== "Backspace") pressed++;
          else if (next.cursor < s.cursor) undone++;
        }
        expect(next.correct + next.errors).toBe(pressed - undone);
        expect(next.total).toBe(accepted);
        s = next;
      }
    });
  });

  it("without backspace in the trace, correct + errors equals the accepted presses exactly", () => {
    forTraces(3, ({ text, settings, trace }) => {
      const noBs = trace.filter((k) => k.key !== "Backspace");
      let s = initialState();
      let accepted = 0;
      for (const k of noBs) {
        const next = applyKeystroke(s, k, text, settings);
        if (next !== s) accepted++;
        s = next;
      }
      expect(s.correct + s.errors).toBe(accepted);
    });
  });

  it("replaying a trace twice yields deep-equal, JSON-serialisable states", () => {
    forTraces(4, ({ text, settings, trace }) => {
      const a = run(text, settings, trace);
      const b = run(text, settings, trace);
      expect(b).toEqual(a);
      expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    });
  });

  it("never mutates its (frozen) inputs", () => {
    forTraces(5, ({ text, settings, trace }) => {
      let s = deepFreeze(initialState());
      deepFreeze(settings);
      for (const k of trace) s = deepFreeze(applyKeystroke(s, deepFreeze(k), text, settings));
    });
  });

  it("an older or post-finish keystroke returns the same reference", () => {
    forTraces(6, ({ text, settings, trace }) => {
      let s = initialState();
      for (const k of trace) {
        const next = applyKeystroke(s, k, text, settings);
        if (k.t < s.lastT || s.status !== "typing") expect(next).toBe(s);
        s = next;
      }
    });
  });
});
