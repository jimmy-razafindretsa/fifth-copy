import { describe, expect, it, vi } from "vitest";
import { generateTypistName, TYPIST_WORDS, withUniqueTypistName } from "./names";
import { EN_WORDS, FR_WORDS } from "./words";

// Deterministic generator (mulberry32) so draws are reproducible.
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BIBLE_EN = ["Sparrow", "Badger", "Heron", "Marmot", "Lynx", "Otter", "Crow", "Hedgehog"];
const BIBLE_FR = [
  "Moineau",
  "Blaireau",
  "Héron",
  "Marmotte",
  "Lynx",
  "Loutre",
  "Corbeau",
  "Hérisson",
];

describe("word lists (C1)", () => {
  it.each([
    ["EN", EN_WORDS, BIBLE_EN],
    ["FR", FR_WORDS, BIBLE_FR],
  ] as const)(
    "%s has >= 60 unique single words including the 8 bible animals",
    (_l, words, bible) => {
      expect(words.length).toBeGreaterThanOrEqual(60);
      expect(new Set(words).size).toBe(words.length);
      for (const w of words) expect(w).toMatch(/^\p{Lu}\p{Ll}+$/u);
      for (const a of bible) expect(words).toContain(a);
    },
  );

  it("draws from the deduplicated union of both lists", () => {
    expect(new Set(TYPIST_WORDS).size).toBe(TYPIST_WORDS.length);
    expect(TYPIST_WORDS).toEqual(expect.arrayContaining([...EN_WORDS, ...FR_WORDS]));
  });
});

describe("generateTypistName (C1)", () => {
  it("returns <Word>-<100..999> with no honorific", () => {
    const rng = seeded(1);
    for (let i = 0; i < 500; i++) {
      const name = generateTypistName(rng);
      const match = /^([^\s-]+)-(\d{3})$/u.exec(name);
      expect(match, name).not.toBeNull();
      expect(TYPIST_WORDS).toContain(match![1]);
      expect(Number(match![2])).toBeGreaterThanOrEqual(100);
      expect(name).not.toMatch(/comrade|camarade/i);
    }
  });

  it("is pure: the same rng sequence gives the same name", () => {
    expect(generateTypistName(seeded(42))).toBe(generateTypistName(seeded(42)));
  });

  it("covers both ends of the word list and the number range", () => {
    expect(generateTypistName(() => 0)).toBe(`${TYPIST_WORDS[0]}-100`);
    expect(generateTypistName(() => 0.999999)).toBe(`${TYPIST_WORDS.at(-1)}-999`);
  });

  it("accepts an injected word list", () => {
    expect(generateTypistName(() => 0.5, ["Desk"])).toBe("Desk-550");
  });
});

describe("withUniqueTypistName (C4)", () => {
  it("returns the first free name", async () => {
    const tryCreate = vi.fn(async (name: string) => ({ name }));
    await expect(withUniqueTypistName(seeded(7), tryCreate)).resolves.toEqual({
      name: expect.stringMatching(/^[^\s-]+-\d{3}$/u),
    });
    expect(tryCreate).toHaveBeenCalledTimes(1);
  });

  it("retries 5 three-digit draws, then falls back to a 4-digit suffix", async () => {
    const tried: string[] = [];
    const tryCreate = async (name: string) => {
      tried.push(name);
      return tried.length <= 5 ? null : { name };
    };
    const result = await withUniqueTypistName(seeded(7), tryCreate);
    expect(tried.slice(0, 5).every((n) => /^[^\s-]+-\d{3}$/u.test(n))).toBe(true);
    expect(result.name).toMatch(/^[^\s-]+-\d{4}$/u);
    expect(tried).toHaveLength(6);
  });

  it("gives up with an error carrying no names once every draw collides", async () => {
    const tryCreate = vi.fn(async () => null);
    const err = await withUniqueTypistName(seeded(7), tryCreate).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/\d/);
    expect(tryCreate).toHaveBeenCalledTimes(10);
  });
});
