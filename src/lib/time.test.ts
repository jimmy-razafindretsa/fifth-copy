import { describe, expect, it } from "vitest";
import { addDays, dayKey, STATS_TIME_ZONE, statsDayNoon } from "./time";

// #931 C1 (ADR 0008): the stats day is the calendar day in America/Toronto, whatever the server zone.
describe("STATS_TIME_ZONE", () => {
  it("is America/Toronto", () => {
    expect(STATS_TIME_ZONE).toBe("America/Toronto");
  });
});

describe("dayKey", () => {
  it("keeps a race at 23:30 Toronto time on that Toronto day, though it is the next day in UTC", () => {
    // 2026-11-12 23:30 EST (UTC-5) = 2026-11-13 04:30 UTC.
    expect(dayKey(new Date("2026-11-13T04:30:00Z"))).toBe("2026-11-12");
  });

  it("puts a race at 00:30 Toronto time on the new Toronto day", () => {
    // 2026-11-13 00:30 EST = 2026-11-13 05:30 UTC.
    expect(dayKey(new Date("2026-11-13T05:30:00Z"))).toBe("2026-11-13");
    // One hour earlier is still the day before.
    expect(dayKey(new Date("2026-11-13T04:59:59Z"))).toBe("2026-11-12");
  });

  it("follows the spring DST change (EST to EDT, 2026-03-08 02:00 local)", () => {
    // Before the change midnight is 05:00 UTC; after it, 04:00 UTC.
    expect(dayKey(new Date("2026-03-08T04:59:00Z"))).toBe("2026-03-07");
    expect(dayKey(new Date("2026-03-08T05:00:00Z"))).toBe("2026-03-08");
    expect(dayKey(new Date("2026-03-09T03:59:00Z"))).toBe("2026-03-08");
    expect(dayKey(new Date("2026-03-09T04:00:00Z"))).toBe("2026-03-09");
    // 23:30 and 00:30 local on the day after the change (EDT, UTC-4).
    expect(dayKey(new Date("2026-03-10T03:30:00Z"))).toBe("2026-03-09");
    expect(dayKey(new Date("2026-03-10T04:30:00Z"))).toBe("2026-03-10");
  });

  it("follows the autumn DST change (EDT to EST, 2026-11-01 02:00 local)", () => {
    // Before the change midnight is 04:00 UTC; after it, 05:00 UTC.
    expect(dayKey(new Date("2026-11-01T03:59:00Z"))).toBe("2026-10-31");
    expect(dayKey(new Date("2026-11-01T04:00:00Z"))).toBe("2026-11-01");
    // 01:30 local happens twice on the change night; both are 2026-11-01.
    expect(dayKey(new Date("2026-11-01T05:30:00Z"))).toBe("2026-11-01");
    expect(dayKey(new Date("2026-11-01T06:30:00Z"))).toBe("2026-11-01");
    expect(dayKey(new Date("2026-11-02T04:59:00Z"))).toBe("2026-11-01");
    expect(dayKey(new Date("2026-11-02T05:00:00Z"))).toBe("2026-11-02");
  });

  it("pads month and day", () => {
    expect(dayKey(new Date("2026-01-05T17:00:00Z"))).toBe("2026-01-05");
  });
});

describe("addDays", () => {
  it("moves a day key by whole calendar days across months, years and DST", () => {
    expect(addDays("2026-11-13", -1)).toBe("2026-11-12");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-09", -1)).toBe("2026-03-08");
    expect(addDays("2026-11-01", -6)).toBe("2026-10-26");
    expect(addDays("2026-11-13", 0)).toBe("2026-11-13");
  });
});

// #975 C1: back-dated e2e results land on Toronto's yesterday and the day before at any UTC time.
describe("statsDayNoon", () => {
  it("between 00:00Z and 05:00Z counts from the Toronto day, not the UTC day", () => {
    // 2026-11-17 00:03Z and 04:59Z are still 2026-11-16 in Toronto (EST, UTC-5).
    for (const now of [new Date("2026-11-17T00:03:00Z"), new Date("2026-11-17T04:59:00Z")]) {
      expect(dayKey(now)).toBe("2026-11-16");
      expect(statsDayNoon(1, now).toISOString()).toBe("2026-11-15T17:00:00.000Z");
      expect(statsDayNoon(2, now).toISOString()).toBe("2026-11-14T17:00:00.000Z");
      expect(dayKey(statsDayNoon(1, now))).toBe(addDays(dayKey(now), -1));
      expect(dayKey(statsDayNoon(2, now))).toBe(addDays(dayKey(now), -2));
    }
  });

  it("after 05:00Z the Toronto and UTC days agree", () => {
    const now = new Date("2026-11-17T05:00:00Z");
    expect(statsDayNoon(1, now).toISOString()).toBe("2026-11-16T17:00:00.000Z");
    expect(statsDayNoon(0, now).toISOString()).toBe("2026-11-17T17:00:00.000Z");
  });

  it("stays inside the Toronto day under daylight time (17:00Z = 13:00 EDT)", () => {
    const now = new Date("2026-07-02T03:30:00Z"); // 2026-07-01 23:30 EDT
    expect(dayKey(statsDayNoon(1, now))).toBe("2026-06-30");
    expect(dayKey(statsDayNoon(2, now))).toBe("2026-06-29");
  });
});
