import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SOUND_NAMES } from "./sounds";

// #243 C1: every sound file is on file in public/sounds/LICENSES.md (source URL, author, CC0 or CC-BY 4.0,
// attribution text), each file <= 60 kB and the set <= 200 kB.
const DIR = path.resolve("public/sounds");
const FILE_MAX = 60_000;
const SET_MAX = 200_000;

type Row = { file: string; source: string; author: string; licence: string; attribution: string };

function rows(): Row[] {
  const md = fs.readFileSync(path.join(DIR, "LICENSES.md"), "utf8");
  return md
    .split("\n")
    .filter((l) => l.startsWith("|") && !/^\|\s*(File|---)/.test(l))
    .map((l) => {
      const [file, source, author, licence, attribution] = l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      return {
        file: file!,
        source: source!,
        author: author!,
        licence: licence!,
        attribution: attribution!,
      };
    });
}

const audioFiles = () => fs.readdirSync(DIR).filter((f) => f !== "LICENSES.md");

describe("#243 C1 the sound set's licences and sizes", () => {
  it("lists every file once, with a source URL, an author, CC0 or CC-BY 4.0 and its attribution", () => {
    const table = rows();
    expect(table.map((r) => r.file).sort()).toEqual(audioFiles().sort());
    expect(new Set(table.map((r) => r.file)).size).toBe(table.length);
    for (const r of table) {
      expect(r.source, r.file).toMatch(/^https:\/\/\S+$/);
      expect(r.author, r.file).not.toBe("");
      expect(r.licence, r.file).toMatch(/^(CC0 1\.0|CC-BY 4\.0)$/);
      expect(r.attribution, r.file).not.toBe("");
    }
  });

  it("ships every named sound as .ogg and the .mp3 fallback", () => {
    for (const name of SOUND_NAMES) {
      expect(audioFiles()).toContain(`${name}.ogg`);
      expect(audioFiles()).toContain(`${name}.mp3`);
    }
  });

  it("keeps each file <= 60 kB and the set <= 200 kB", () => {
    const sizes = audioFiles().map((f) => [f, fs.statSync(path.join(DIR, f)).size] as const);
    for (const [f, size] of sizes) expect(size, f).toBeLessThanOrEqual(FILE_MAX);
    expect(sizes.reduce((s, [, n]) => s + n, 0)).toBeLessThanOrEqual(SET_MAX);
  });
});
