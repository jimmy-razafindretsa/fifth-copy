import { describe, expect, it } from "vitest";
import { ARCHIVE_LIMIT, archiveDate, archiveOf, awardOf, modeOf } from "./archive";

// #936 C2, C4: the archive's latest rows, their mode, award and date.
const T0 = Date.UTC(2026, 10, 12, 15, 42); // 12 Nov, 10:42 in Toronto
const row = (minutesAgo: number, place = 2) => ({
  createdAt: new Date(T0 - minutesAgo * 60_000),
  cleanWpm: 40 + minutesAgo,
  accuracy: 0.95,
  place,
});

describe("archiveOf (#936 C2)", () => {
  it("the 8 latest, newest first", () => {
    const rows = Array.from({ length: 11 }, (_, i) => row(i)).reverse();
    const archive = archiveOf(rows);
    expect(ARCHIVE_LIMIT).toBe(8);
    expect(archive.map((e) => e.cleanWpm)).toEqual([40, 41, 42, 43, 44, 45, 46, 47]);
    expect(archive[0]).toEqual({
      at: new Date(T0).toISOString(),
      room: null,
      mode: "BOTS",
      place: 2,
      lobbySize: null,
      cleanWpm: 40,
      accuracy: 0.95,
    });
  });

  it("keeps the room, mode and lobby size; a place under 1 is no place", () => {
    const [e] = archiveOf([{ ...row(0, 0), room: "KGB-4821", mode: "PRIVATE", lobbySize: 24 }]);
    expect(e).toMatchObject({ room: "KGB-4821", mode: "PRIVATE", lobbySize: 24, place: null });
  });
});

describe("modeOf (#936 C2)", () => {
  it("BOTS with no other human, else PRIVATE for a private lobby, else RACE", () => {
    expect(modeOf(0, "PRIVATE")).toBe("BOTS");
    expect(modeOf(0, null)).toBe("BOTS");
    expect(modeOf(3, "PRIVATE")).toBe("PRIVATE");
    expect(modeOf(3, "PUBLIC")).toBe("RACE");
    expect(modeOf(1, null)).toBe("RACE");
  });
});

describe("awardOf and archiveDate (#936 C4)", () => {
  it("place 1 a medal, 2 and 3 a podium, others and none nothing", () => {
    expect([1, 2, 3, 4, null].map(awardOf)).toEqual(["medal", "podium", "podium", null, null]);
  });

  it("12 NOV · 10:42 in the stats time zone, locale month upper case without its dot", () => {
    expect(archiveDate(new Date(T0).toISOString(), "fr")).toBe("12 NOV · 10:42");
    expect(archiveDate(new Date(T0).toISOString(), "en")).toBe("12 NOV · 10:42");
    const feb = new Date(Date.UTC(2026, 1, 3, 1, 5)).toISOString(); // 2 Feb, 20:05 in Toronto
    expect(archiveDate(feb, "fr")).toBe("02 FÉVR · 20:05");
    expect(archiveDate(feb, "en")).toBe("02 FEB · 20:05");
  });
});
