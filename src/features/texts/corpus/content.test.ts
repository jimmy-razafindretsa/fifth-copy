import { describe, expect, it } from "vitest";
import { contentFiles, manifestSource, MANIFEST } from "../../../../scripts/corpus-manifest";
import fs from "node:fs";
import { CONTENT_FILES } from "./manifest";
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
    expect(fileProvider.sourceRef("en")).toBe("files:en:v1");
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
