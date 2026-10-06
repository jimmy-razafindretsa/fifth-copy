import { describe, expect, it } from "vitest";
import { normalize, normalizeRuns } from "./normalize";

describe("normalize (C1)", () => {
  it("lowercases", () => {
    expect(normalize("HeRoN")).toBe("heron");
  });

  it("strips diacritics and expands ligatures", () => {
    expect(normalize("Hérisson")).toBe(normalize("herisson"));
    expect(normalize("Épervier")).toBe("epervier");
    expect(normalize("çàâêîôûüÿ")).toBe(normalize("caaeiouuy"));
    expect(normalize("Cœur")).toBe("coeur");
    expect(normalize("Æther")).toBe("aether");
  });

  it.each([
    ["0", "o"],
    ["1", "i"],
    ["1", "l"],
    ["3", "e"],
    ["4", "a"],
    ["5", "s"],
    ["7", "t"],
    ["@", "a"],
    ["$", "s"],
  ])("maps leetspeak %s like %s", (leet, letter) => {
    expect(normalize(`b${leet}r`)).toBe(normalize(`b${letter}r`));
  });

  it("maps whole leet words onto their plain form", () => {
    expect(normalize("h3r0n")).toBe(normalize("heron"));
    expect(normalize("$p4rr0w")).toBe(normalize("sparrow"));
    expect(normalize("@77ic")).toBe(normalize("attic"));
  });

  it("removes separators (_ - . space) and invisible characters", () => {
    expect(normalize("o_t-t.e r")).toBe(normalize("otter"));
    expect(normalize("o​t‍t­e﻿r")).toBe(normalize("otter"));
  });

  it("collapses repeated letters", () => {
    expect(normalize("ooootttterrrr")).toBe("oter");
    expect(normalize("Otter")).toBe("oter");
    expect(normalize("o-t.t_e r")).toBe("oter");
  });

  it("keeps letter runs in the run-preserving variant", () => {
    expect(normalizeRuns("O_t-t.e r")).toBe("otter");
    expect(normalize("O_t-t.e r")).toBe("oter");
  });

  it("is idempotent", () => {
    for (const s of ["H3r1ss0n", "Épervier_99", "x.X.x"]) {
      expect(normalize(normalize(s))).toBe(normalize(s));
    }
  });
});
