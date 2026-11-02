import { BOT_NAMES } from "@fifth-copy/engine";
import { nameSchema } from "@fifth-copy/protocol";
import { describe, expect, it } from "vitest";
import { isClean } from "@/features/texts";

// Card #361, C7: the race server names bot desks from the engine's bilingual list; the profanity
// filter lives in the web package (the engine imports nothing), so the check runs here.
describe("bot names", () => {
  it.each(["fr", "en"] as const)(
    "%s: at least 30 distinct names, each a valid display name",
    (lang) => {
      const names = BOT_NAMES[lang];
      expect(names.length).toBeGreaterThanOrEqual(30);
      expect(new Set(names).size).toBe(names.length);
      expect(names.filter((n) => !nameSchema.safeParse(n).success)).toEqual([]);
      // A desk title then a surname: in-world clerks, never a bare nickname or a number.
      expect(names.filter((n) => !/^\p{Lu}\p{Ll}+ \p{Lu}[\p{L}'-]+$/u.test(n))).toEqual([]);
    },
  );

  it.each(["fr", "en"] as const)("%s: every name passes isClean", (lang) => {
    expect(BOT_NAMES[lang].filter((n) => !isClean(n))).toEqual([]);
    // The roman-suffixed forms the race server builds from the second cycle on.
    expect(BOT_NAMES[lang].map((n) => `${n} II`).filter((n) => !isClean(n))).toEqual([]);
  });
});
