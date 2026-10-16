import { applyKeystroke, initialState, type EngineSettings } from "@fifth-copy/engine";
import { describe, expect, it } from "vitest";
import { createPrediction } from "../client/prediction";
import { type TypedView, typedViewFixtures, typedViewFrom } from "./typed-view";

// Contract of #558 C1: the TypedView shape and its static fixtures (no logic: #559 derives views).
const NAMES = ["before-start", "racing", "continue-wrong", "block-jammed", "finished"] as const;
const STATES = new Set(["done", "wrong", "next", "remaining"]);
const ACCENTS = ["é", "ç", "ê", "«", "»"];

const entries = Object.entries(typedViewFixtures) as [string, TypedView][];

describe("TypedView fixtures (#558 C1)", () => {
  it("exports the five race states by name", () => {
    expect(Object.keys(typedViewFixtures).sort()).toEqual([...NAMES].sort());
  });

  it("every fixture has exactly the four TypedView fields", () => {
    for (const [name, view] of entries) {
      expect(Object.keys(view).sort(), name).toEqual(["chars", "cursor", "jammed", "lastTypedAt"]);
      expect(Array.isArray(view.chars), name).toBe(true);
      expect(Number.isInteger(view.cursor), name).toBe(true);
      expect(typeof view.jammed, name).toBe("boolean");
      expect(view.lastTypedAt === null || Number.isFinite(view.lastTypedAt), name).toBe(true);
    }
  });

  it("every char is one grapheme with one of the four states", () => {
    for (const [name, view] of entries) {
      for (const c of view.chars) {
        expect(Object.keys(c).sort(), name).toEqual(["ch", "state"]);
        expect(Array.from(c.ch), `${name} ${c.ch}`).toHaveLength(1);
        expect(STATES.has(c.state), `${name} ${c.state}`).toBe(true);
      }
    }
  });

  it("every fixture types the same French text with the accents é ç ê « »", () => {
    const texts = new Set(entries.map(([, v]) => v.chars.map((c) => c.ch).join("")));
    expect(texts.size).toBe(1);
    const [text] = [...texts];
    for (const a of ACCENTS) expect(text, a).toContain(a);
  });

  it("keeps the cursor invariant: typed before it, next at it, remaining after it", () => {
    for (const [name, view] of entries) {
      expect(view.cursor, name).toBeGreaterThanOrEqual(0);
      expect(view.cursor, name).toBeLessThanOrEqual(view.chars.length);
      view.chars.forEach((c, i) => {
        const want =
          i < view.cursor ? ["done", "wrong"] : i === view.cursor ? ["next"] : ["remaining"];
        expect(want, `${name} #${i} ${c.state}`).toContain(c.state);
      });
    }
  });

  it("has exactly one next char unless finished", () => {
    for (const [name, view] of entries) {
      const next = view.chars.filter((c) => c.state === "next");
      expect(next, name).toHaveLength(name === "finished" ? 0 : 1);
    }
    const done = typedViewFixtures.finished;
    expect(done.cursor).toBe(done.chars.length);
  });

  it("before-start has typed nothing; the others have a last keystroke time", () => {
    const start = typedViewFixtures["before-start"];
    expect(start.cursor).toBe(0);
    expect(start.lastTypedAt).toBeNull();
    for (const name of NAMES.filter((n) => n !== "before-start")) {
      expect(typedViewFixtures[name].cursor, name).toBeGreaterThan(0);
      expect(typedViewFixtures[name].lastTypedAt, name).not.toBeNull();
    }
  });

  it("only continue-wrong carries wrong chars; only block-jammed is jammed", () => {
    for (const [name, view] of entries) {
      const wrong = view.chars.filter((c) => c.state === "wrong").length;
      expect(wrong > 0, name).toBe(name === "continue-wrong");
      expect(view.jammed, name).toBe(name === "block-jammed");
    }
  });
});

// Contract of #559 C3: `typedViewFrom(engineState, text)` derives the #558 TypedView from the engine's own
// state (ADR 0007: the view reads what the engine recorded, it never compares a key with the text).
describe("typedViewFrom (#559 C3)", () => {
  const TEXT = "Le reçu « ok »";
  const CONTINUE: EngineSettings = { errorMode: "continue", backspace: true };
  const BLOCK: EngineSettings = { errorMode: "block", backspace: true };
  const type = (keys: string, settings: EngineSettings, t0 = 100) =>
    Array.from(keys).reduce(
      (s, key, i) =>
        applyKeystroke(s, { t: t0 + i * 40, key: key === "<" ? "Backspace" : key }, TEXT, settings),
      initialState(),
    );
  const states = (view: TypedView) => view.chars.map((c) => c.state[0]).join("");

  it("before the first key: every char of the text, the first one next, no keystroke time", () => {
    const view = typedViewFrom(initialState(), TEXT);
    expect(view.chars.map((c) => c.ch).join("")).toBe(TEXT);
    expect(view.chars).toHaveLength(Array.from(TEXT).length);
    expect(states(view)).toBe("n" + "r".repeat(Array.from(TEXT).length - 1));
    expect(view).toMatchObject({ cursor: 0, jammed: false, lastTypedAt: null });
  });

  it("Continue: right keys are done, a wrong key is wrong and the cursor moves on", () => {
    const s = type("Lx r", CONTINUE);
    const view = typedViewFrom(s, TEXT);
    expect(states(view).slice(0, 6)).toBe("dwddnr");
    expect(view.cursor).toBe(4);
    expect(view.jammed).toBe(false);
    expect(view.lastTypedAt).toBe(s.lastT);
  });

  it("Continue: Backspace takes the struck char back", () => {
    const view = typedViewFrom(type("Lx<e", CONTINUE), TEXT);
    expect(states(view).slice(0, 3)).toBe("ddn");
    expect(view.cursor).toBe(2);
  });

  it("Block: a wrong key holds the cursor and jams the machine until the right key", () => {
    const p = createPrediction({ text: TEXT, settings: BLOCK, apply: applyKeystroke })
      .push({ t: 100, key: "L" })
      .push({ t: 140, key: "x" });
    const jammed = typedViewFrom(p.state, p.text, { jammed: p.jammed });
    expect(states(jammed).slice(0, 3)).toBe("dnr");
    expect(jammed.cursor).toBe(1);
    expect(jammed.jammed).toBe(true);
    const released = p.push({ t: 180, key: "e" });
    const view = typedViewFrom(released.state, released.text, { jammed: released.jammed });
    expect(states(view).slice(0, 3)).toBe("ddn");
    expect(view.jammed).toBe(false);
    // Block never leaves a wrong char on the copy
    expect(view.chars.some((c) => c.state === "wrong")).toBe(false);
  });

  it("finished: every char typed, the cursor at the end, no next char", () => {
    const s = type(TEXT, CONTINUE);
    expect(s.status).toBe("finished");
    const view = typedViewFrom(s, TEXT);
    expect(view.cursor).toBe(view.chars.length);
    expect(view.chars.every((c) => c.state === "done")).toBe(true);
  });

  it("returns a TypedView with exactly the #558 fields and its cursor invariant", () => {
    for (const s of [initialState(), type("Lx r", CONTINUE), type(TEXT, CONTINUE)]) {
      const view = typedViewFrom(s, TEXT);
      expect(Object.keys(view).sort()).toEqual(["chars", "cursor", "jammed", "lastTypedAt"]);
      view.chars.forEach((c, i) => {
        const want =
          i < view.cursor ? ["done", "wrong"] : i === view.cursor ? ["next"] : ["remaining"];
        expect(want).toContain(c.state);
      });
    }
  });
});
