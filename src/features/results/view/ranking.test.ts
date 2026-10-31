import { describe, expect, it } from "vitest";
import { REPORT_STATUSES, type ReportEntry } from "./dawn-report";
import { initialsOf, rankingRowsFrom } from "./ranking";

// Contract of #301 C1: `rankingRowsFrom(entries, viewerDesk)` is pure; rows in place order, place `01`,
// WPM an integer, accuracy a whole percent, `you` on the viewer's row, the six status keys, initials.
const entry = (over: Partial<ReportEntry>): ReportEntry => ({
  desk: 1,
  name: "Lynx-785",
  isBot: false,
  place: 1,
  status: "FINISHED",
  wpm: 61.4,
  accuracy: 0.97,
  progress: 1,
  finishedAtMs: 48_200,
  suspicious: false,
  outfit: { hair: "crop", glasses: "none", hat: "none", clothes: "shirt", face: "none", hairCol: "x" },
  ...over,
});

describe("rankingRowsFrom (#301 C1)", () => {
  const entries = [
    entry({ desk: 9, place: 3, name: "Badger-126", wpm: 31.5, accuracy: 0.974 }),
    entry({ desk: 7, place: 1, name: "Lynx-785", wpm: 61.4, accuracy: 0.97 }),
    entry({ desk: 4, place: 2, name: "Otter-417", wpm: 38.1, status: "LINE_CUT", accuracy: 0.5 }),
    entry({ desk: 2, place: 2, name: "Typist Bot 2", isBot: true, suspicious: true }),
  ];

  it("orders rows by place (then desk) and pads the place", () => {
    const rows = rankingRowsFrom(entries, null);
    expect(rows.map((r) => [r.place, r.desk])).toEqual([
      ["01", 7],
      ["02", 2],
      ["02", 4],
      ["03", 9],
    ]);
    expect(rankingRowsFrom([entry({ place: 12 })], null)[0]!.place).toBe("12");
  });

  it("is pure: the input is not reordered or changed", () => {
    const before = JSON.stringify(entries);
    rankingRowsFrom(entries, 7);
    expect(JSON.stringify(entries)).toBe(before);
    expect(rankingRowsFrom(entries, 7)).toEqual(rankingRowsFrom(entries, 7));
  });

  it.each([
    [61.4, 61],
    [31.5, 32],
    [0.4, 0],
    [-3, 0],
  ])("wpm %d -> %d", (wpm, want) => {
    expect(rankingRowsFrom([entry({ wpm })], null)[0]!.wpm).toBe(want);
  });

  it.each([
    [0.974, 97],
    [0.975, 98],
    [1, 100],
    [0, 0],
    [1.2, 100],
    [-0.1, 0],
  ])("accuracy %d -> %d", (accuracy, want) => {
    expect(rankingRowsFrom([entry({ accuracy })], null)[0]!.accuracy).toBe(want);
  });

  it("marks only the viewer's row; a spectator has none", () => {
    expect(rankingRowsFrom(entries, 4).map((r) => r.you)).toEqual([false, false, true, false]);
    expect(rankingRowsFrom(entries, null).some((r) => r.you)).toBe(false);
    expect(rankingRowsFrom(entries, 99).some((r) => r.you)).toBe(false);
  });

  it("keeps the bot, suspicious and status of each entry; statusKey is one of the six", () => {
    const rows = rankingRowsFrom(
      REPORT_STATUSES.map((status, i) => entry({ desk: i + 1, place: i + 1, status })),
      null,
    );
    expect(rows.map((r) => r.statusKey)).toEqual([...REPORT_STATUSES]);
    const bot = rankingRowsFrom(entries, null).find((r) => r.desk === 2)!;
    expect(bot).toMatchObject({ isBot: true, suspicious: true, name: "Typist Bot 2", initials: "TB" });
    expect(bot.avatarUrl).toBeUndefined();
  });
});

describe("initialsOf (#301 C1)", () => {
  it.each([
    ["Lynx-785", "L"],
    ["Typist Bot 2", "TB"],
    ["  heron   gris  ", "HG"],
    ["élodie", "É"],
    // decomposed e + combining acute: NFC first, then the first code point
    ["élodie roy", "ÉR"],
    ["𝒜lpha beta", "𝒜B"],
    ["", ""],
    ["   ", ""],
  ])("%j -> %j", (name, want) => {
    expect(initialsOf(name)).toBe(want);
  });
});
