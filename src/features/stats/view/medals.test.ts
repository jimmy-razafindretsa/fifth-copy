import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { ACHIEVEMENT_IDS } from "../achievements/ids";
import { emptyShelf, MEDAL_NEW_DAYS, medalShelf } from "./medals";

const now = new Date("2026-11-19T15:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

// #999 C36: the enamel pins on the Personnel file, the whole catalogue: none, some, locked, new.
describe("medalShelf", () => {
  it("none earned: every pin of the catalogue locked, in the ids' order", () => {
    const shelf = medalShelf([], now);
    expect(shelf.earned).toBe(0);
    expect(shelf.medals.map((m) => m.id)).toEqual([...ACHIEVEMENT_IDS]);
    expect(shelf.medals.every((m) => m.state === "locked" && m.awardedAt === null)).toBe(true);
    expect(shelf.medals.map((m) => m.code)).toEqual([
      "PIN-01",
      "PIN-02",
      "PIN-03",
      "PIN-04",
      "PIN-05",
    ]);
    expect(emptyShelf().earned).toBe(0);
  });

  it("some earned: old awards earned, recent ones new, the rest locked; retired ids ignored", () => {
    const shelf = medalShelf(
      [
        { achievementId: "first-win", awardedAt: daysAgo(30) },
        { achievementId: "accuracy-100", awardedAt: daysAgo(MEDAL_NEW_DAYS) },
        { achievementId: "retired-pin", awardedAt: daysAgo(1) },
      ],
      now,
    );
    expect(shelf.earned).toBe(2);
    const state = Object.fromEntries(shelf.medals.map((m) => [m.id, m.state]));
    expect(state).toEqual({
      "first-win": "earned",
      "wpm-50-club": "locked",
      "accuracy-100": "new",
      "accent-master": "locked",
      "streak-7-days": "locked",
    });
    expect(shelf.medals[0]!.awardedAt).toEqual(daysAgo(30));
  });

  it("a pin pinned just over the window is no longer new", () => {
    const shelf = medalShelf(
      [{ achievementId: "wpm-50-club", awardedAt: daysAgo(MEDAL_NEW_DAYS + 0.01) }],
      now,
    );
    expect(shelf.medals[1]!.state).toBe("earned");
  });
});

// #999 C40: every pin has its in-world name and description in both languages.
describe("pin copy (C40)", () => {
  for (const [locale, catalog] of [
    ["en", en],
    ["fr", fr],
  ] as const) {
    it(`${locale}: a name and a description for each achievement id, and no other`, () => {
      expect(Object.keys(catalog.profile.medals.pins).sort()).toEqual([...ACHIEVEMENT_IDS].sort());
      for (const id of ACHIEVEMENT_IDS) {
        const pin = catalog.profile.medals.pins[id];
        expect(pin.name, id).toMatch(/\S/);
        expect(pin.description, id).toMatch(/\.$/);
      }
    });
  }
});
