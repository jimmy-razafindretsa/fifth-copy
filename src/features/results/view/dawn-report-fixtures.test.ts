import { describe, expect, it, vi } from "vitest";

// Contract of #688 C1: every fixture entry carries an outfit; the viewer fixture's desk 12 wears a saved
// one and the bot (desk 3) wears its desk's fixed outfit, as `getDawnReport` would resolve them.
vi.mock("@/env", () => ({ env: {} }));
const { outfitForDesk, parseOutfit } = await import("@/features/identity");
const { dawnReportFixtures, personalFixtures, SAVED_OUTFIT } =
  await import("./dawn-report-fixtures");

describe("dawnReportFixtures outfits (#688 C1)", () => {
  it("every entry of every fixture wears an outfit the catalogue accepts", () => {
    for (const [name, report] of Object.entries(dawnReportFixtures)) {
      for (const e of report.entries)
        expect(parseOutfit(e.outfit), `${name} desk ${e.desk}`).toEqual(e.outfit);
    }
  });

  it("the viewer's desk 12 wears the saved outfit, the bot outfitForDesk(3)", () => {
    const { entries, viewerDesk } = dawnReportFixtures.viewer;
    expect(viewerDesk).toBe(12);
    expect(entries.find((e) => e.desk === 12)?.outfit).toEqual(SAVED_OUTFIT);
    expect(SAVED_OUTFIT).not.toEqual(outfitForDesk(12));
    const bot = entries.find((e) => e.isBot)!;
    expect(bot.desk).toBe(3);
    expect(bot.outfit).toEqual(outfitForDesk(3));
  });

  it("the other desks wear their desk's outfit", () => {
    for (const e of dawnReportFixtures.full.entries.filter((x) => x.desk !== 12)) {
      expect(e.outfit, `desk ${e.desk}`).toEqual(outfitForDesk(e.desk));
    }
  });
});

describe("personalFixtures (#864 C4)", () => {
  it("each state is the figures of its desk's row in the six-desk race", () => {
    for (const [name, p] of Object.entries(personalFixtures)) {
      const e = dawnReportFixtures.full.entries.find((x) => x.desk === p.desk)!;
      expect(
        { place: p.place, wpm: p.wpm, accuracy: p.accuracy, status: p.status, sus: p.suspicious },
        name,
      ).toEqual({
        place: e.place,
        wpm: e.wpm,
        accuracy: e.accuracy,
        status: e.status,
        sus: e.suspicious,
      });
    }
  });

  it("the viewer fixture carries desk 12's populated card; the others none", () => {
    expect(dawnReportFixtures.viewer.personal).toEqual(personalFixtures.populated);
    expect(dawnReportFixtures.full.personal).toBeNull();
  });
});
