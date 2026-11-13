import { describe, expect, it } from "vitest";
import { EMPTY_SERVICE } from "./profile";
import { fileNumber, figures, oneDecimal, serviceDate, totalTime, tubes } from "./profile-figures";

// #932 C4, C5, C7: display formatting only, in the page's locale.
describe("profile figures", () => {
  it("one decimal in the locale, total time as hh:mm:ss, the date in the stats zone", () => {
    expect(oneDecimal(44.75, "fr")).toBe("44,8");
    expect(oneDecimal(1234.56, "en")).toBe("1,234.6");
    expect(totalTime(0)).toBe("00:00:00");
    expect(totalTime(52_328_000)).toBe("14:32:08");
    expect(totalTime(100 * 3_600_000)).toBe("100:00:00");
    // 03:00 UTC on May 25 is still May 24 in Toronto.
    expect(serviceDate(new Date("2023-05-25T03:00:00Z"), "fr")).toBe("24 mai 2023");
    expect(serviceDate(new Date("2023-05-25T03:00:00Z"), "en")).toBe("May 24, 2023");
  });

  it("the file number is the name's trailing digits", () => {
    expect(fileNumber("DOCKET-829")).toBe("829");
    expect(fileNumber("Olga")).toBeNull();
    expect(fileNumber("R2D2X")).toBeNull();
    expect(fileNumber(null)).toBeNull();
  });

  it("blank service: tubes --, --, --, 00 and every figure — with no unit", () => {
    expect(tubes(EMPTY_SERVICE, "en").map((t) => t.value)).toEqual(["--", "--", "--", "00"]);
    for (const f of figures(EMPTY_SERVICE, "en")) {
      expect(f.value).toBe("—");
      expect(f.unit).toBeNull();
    }
  });
});
