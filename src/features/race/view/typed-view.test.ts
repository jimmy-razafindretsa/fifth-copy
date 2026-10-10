import { describe, expect, it } from "vitest";
import { type TypedView, typedViewFixtures } from "./typed-view";

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
