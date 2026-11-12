import { describe, expect, it } from "vitest";
import {
  contentFiles,
  contentVersion,
  manifestSource,
  MANIFEST,
} from "../../../../scripts/corpus-manifest";
import fs from "node:fs";
import { CONTENT_FILES, CONTENT_VERSION } from "./manifest";
import { fileProvider, parseContentFile, passagesOf } from "./files";
import { contentFileSchema, issuesOf } from "./schema";

// Contract of #351 C1, C2: the corpus lives in attributed content files, each one valid against
// `schema.ts`; a bad file fails naming the file and the passage.

const good = {
  language: "en",
  source: "Jane Austen, Emma (1815)",
  licence: "public domain",
  authorType: "public-domain",
  reviewed: null,
  passages: [
    "Emma Woodhouse, handsome, clever, and rich, with a comfortable home and happy disposition.",
  ],
};

/** The `<file>: <issues>` failure the content test prints for a raw file. */
const failureOf = (name: string, raw: unknown) => {
  try {
    parseContentFile(name, raw);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

describe("content files (C1)", () => {
  it("the seed TypeScript arrays are gone", () => {
    expect(fs.existsSync("src/features/texts/generate/seed-en.ts")).toBe(false);
    expect(fs.existsSync("src/features/texts/generate/seed-fr.ts")).toBe(false);
  });

  it("the generated manifest lists every content file on disk (npm run corpus)", () => {
    expect(fs.readFileSync(MANIFEST, "utf8")).toBe(manifestSource(contentFiles()));
    expect(CONTENT_FILES.map(([name]) => name)).toEqual(contentFiles());
  });

  it("fileProvider is the default provider and reads the passages", () => {
    expect(fileProvider.sentences("fr")).toBe(passagesOf("fr"));
  });
});

// Contract of #342 C7: the provider's sourceRef is a version of the file set, so it changes with the content.
describe("sourceRef follows the content (#342 C7)", () => {
  it("is files:<language>:<hash of that language's files>", () => {
    for (const language of ["en", "fr"] as const) {
      expect(fileProvider.sourceRef(language)).toBe(
        `files:${language}:${CONTENT_VERSION[language]}`,
      );
      expect(CONTENT_VERSION[language]).toBe(contentVersion(language, contentFiles()));
      expect(CONTENT_VERSION[language]).toMatch(/^[0-9a-f]{12}$/);
    }
    expect(CONTENT_VERSION.en).not.toBe(CONTENT_VERSION.fr);
  });

  it("changes when a file is edited, added or removed, and only for its language", () => {
    const files = ["en/a.json", "en/b.json", "fr/c.json"];
    const bytes: Record<string, string> = { "en/a.json": "A", "en/b.json": "B", "fr/c.json": "C" };
    const v = (lang: string, list = files, data = bytes) =>
      contentVersion(lang, list, (f) => data[f]!);
    const base = v("en");
    expect(v("en", files, { ...bytes, "en/a.json": "A2" })).not.toBe(base);
    expect(v("en", [...files, "en/d.json"], { ...bytes, "en/d.json": "D" })).not.toBe(base);
    expect(v("en", files.slice(1))).not.toBe(base);
    expect(v("en", files, { ...bytes, "fr/c.json": "C2" })).toBe(base);
  });
});

describe("every content file is valid (C2)", () => {
  for (const [name, raw] of CONTENT_FILES) {
    it(name, () => {
      const parsed = contentFileSchema.safeParse(raw);
      expect(parsed.success ? [] : issuesOf(parsed.error), name).toEqual([]);
      expect(failureOf(name, raw)).toBeNull();
    });
  }

  it("prints the passage count per language; each holds at least 30", () => {
    for (const language of ["fr", "en"] as const) {
      const passages = passagesOf(language);
      console.log(`corpus ${language}: ${passages.length} passages`);
      expect(passages.length).toBeGreaterThanOrEqual(30);
      expect(new Set(passages.map((p) => p.text)).size).toBe(passages.length);
    }
  });
});

describe("a bad content file fails naming the file and the passage (C2)", () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ["a missing source", { ...good, source: undefined }, /^en\/bad\.json: source: /],
    ["an empty licence", { ...good, licence: " " }, /^en\/bad\.json: licence: licence is required/],
    [
      "a passage under 12 words",
      { ...good, passages: ["Call me Ishmael."] },
      /passages\.0: passage "Call me Ishmael\." has 3 words \(12 to 80\)/,
    ],
    [
      "a passage over 80 words",
      { ...good, passages: [Array.from({ length: 81 }, () => "word").join(" ")] },
      /passages\.0: passage "word word .*" has 81 words/,
    ],
    [
      "a passage normalizeTypeable would change",
      { ...good, passages: ["It was the best of times, it was the worst of times — truly."] },
      /passages\.0: passage ".*" is not typeable as written/,
    ],
    [
      "a passage isClean rejects",
      { ...good, passages: ["You are a fucking bore, said the man to his neighbour at dinner."] },
      /passages\.0: passage "You are a .*" is refused by isClean/,
    ],
    ["a file in the wrong language folder", { ...good, language: "fr" }, /outside its folder/],
  ];
  for (const [label, raw, message] of cases) {
    it(label, () => {
      expect(failureOf("en/bad.json", raw)).toMatch(message);
    });
  }
});
