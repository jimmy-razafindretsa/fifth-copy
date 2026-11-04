import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// C1 of #57: the stamp reads the one-shot `fc_merged` cookie (a mocked jar) and renders the
// bilingual sentence with its plural forms for 0, 1 and n; no cookie (or a bad one) renders nothing.
const jar = new Map<string, string>();
let locale = "en";
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name === "locale") return { name, value: locale };
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));

const { MergeStamp } = await import("./merge-stamp");
const { MERGED_COOKIE, mergedRaces, mergePluralForm, parseMergedFlash } =
  await import("../merge/flash-cookie");

async function render(): Promise<string> {
  const el = await MergeStamp();
  return el ? renderToStaticMarkup(el) : "";
}

beforeEach(() => {
  jar.clear();
  locale = "en";
});

describe("parseMergedFlash (#57 C1)", () => {
  it("accepts a whole number of races", () => {
    expect(parseMergedFlash("0")).toBe(0);
    expect(parseMergedFlash("1")).toBe(1);
    expect(parseMergedFlash("42")).toBe(42);
  });

  it("refuses anything else", () => {
    for (const bad of [undefined, "", "-1", "1.5", "abc", "1e3", " 3", "99999999"]) {
      expect(parseMergedFlash(bad), String(bad)).toBeNull();
    }
  });

  it("counts the moved race results of a merge", () => {
    expect(mergedRaces({ RaceResult: 3, RaceKeystrokes: 3, User: 1 })).toBe(3);
    expect(mergedRaces({ User: 0 })).toBe(0);
  });

  it("picks the plural form for 0, 1 and n", () => {
    expect(mergePluralForm(0)).toBe("zero");
    expect(mergePluralForm(1)).toBe("one");
    expect(mergePluralForm(2)).toBe("other");
    expect(mergePluralForm(30)).toBe("other");
  });
});

describe("MergeStamp (#57 C1)", () => {
  it("renders nothing without the cookie or with a forged one", async () => {
    expect(await render()).toBe("");
    jar.set(MERGED_COOKIE, "lots");
    expect(await render()).toBe("");
  });

  it.each([
    ["0", "0 races and your stats were carried into your Personnel file.", "0 RACES CARRIED"],
    ["1", "1 race and your stats were carried into your Personnel file.", "1 RACE CARRIED"],
    ["7", "7 races and your stats were carried into your Personnel file.", "7 RACES CARRIED"],
  ])("English, %s races", async (n, sentence, carried) => {
    jar.set(MERGED_COOKIE, n);
    const html = await render();
    expect(html).toContain(sentence);
    expect(html).toContain(carried);
    expect(html).toContain("FILED");
    expect(html).toContain("DISMISS");
    expect(html).toContain('data-stamp-tone="ink"');
  });

  it.each([
    [
      "0",
      "0 course et tes statistiques ont été versées à ton dossier du personnel.",
      "0 COURSE REPORTÉE",
    ],
    [
      "1",
      "1 course et tes statistiques ont été versées à ton dossier du personnel.",
      "1 COURSE REPORTÉE",
    ],
    [
      "7",
      "7 courses et tes statistiques ont été versées à ton dossier du personnel.",
      "7 COURSES REPORTÉES",
    ],
  ])("French, %s races", async (n, sentence, carried) => {
    locale = "fr";
    jar.set(MERGED_COOKIE, n);
    const html = await render();
    expect(html).toContain(sentence.replace(/'/g, "&#x27;"));
    expect(html).toContain(carried);
    expect(html).toContain("CLASSÉ");
    expect(html).toContain("FERMER");
  });
});
