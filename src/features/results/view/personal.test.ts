import { describe, expect, it } from "vitest";
import { EMPTY_LEDGER, record, type BonusEvent } from "@fifth-copy/engine";
import { BONUS_KINDS, parseBonusLog, personalFrom, tallyBonuses } from "./personal";

// Contract of #864 C1 (view half): the viewer's own figures and bonuses, grouped by kind with counts.
// Sent: entries whose `from` is the desk, one per play (a smoke break hitting three desks is three log
// entries, one play). Received: entries whose `to` is the desk, played by another desk (an exemption on
// oneself is sent, not received). Both agree with the engine's ledger (`record`), the stored counters.

const DESK = 7;

describe("tallyBonuses (#864 C1)", () => {
  it("no log: nothing sent, nothing received", () => {
    expect(tallyBonuses(DESK, [])).toEqual({ sent: [], received: [] });
  });

  it("groups by kind in the catalogue's order, one per play sent, one per hit received", () => {
    const log = [
      // desk 7's smoke break hits desks 2, 3 and 4: one play
      { t: 30_000, kind: "smoke-break" as const, from: 7, to: 2 },
      { t: 30_000, kind: "smoke-break" as const, from: 7, to: 3 },
      { t: 30_000, kind: "smoke-break" as const, from: 7, to: 4 },
      // two extra paperworks sent on the leader
      { t: 10_000, kind: "extra-paperwork" as const, from: 7, to: 2 },
      { t: 50_000, kind: "extra-paperwork" as const, from: 7, to: 2 },
      // an exemption on itself: sent, not received
      { t: 70_000, kind: "exemption" as const, from: 7, to: 7 },
      // hit twice by extra paperwork and once by a smoke break
      { t: 12_000, kind: "extra-paperwork" as const, from: 9, to: 7 },
      { t: 40_000, kind: "extra-paperwork" as const, from: 11, to: 7 },
      { t: 41_000, kind: "smoke-break" as const, from: 9, to: 7 },
    ];
    expect(tallyBonuses(DESK, log)).toEqual({
      sent: [
        { kind: "extra-paperwork", count: 2 },
        { kind: "exemption", count: 1 },
        { kind: "smoke-break", count: 1 },
      ],
      received: [
        { kind: "extra-paperwork", count: 2 },
        { kind: "smoke-break", count: 1 },
      ],
    });
  });

  it("ignores entries the desk is not part of", () => {
    expect(tallyBonuses(DESK, [{ t: 1, kind: "extra-paperwork", from: 3, to: 4 }])).toEqual({
      sent: [],
      received: [],
    });
  });

  it("agrees with the engine's ledger (the stored bonusesSent and bonusesReceived)", () => {
    const events: BonusEvent[] = [
      { t: 5_000, kind: "extra-paperwork", from: 7, to: [1] },
      { t: 9_000, kind: "smoke-break", from: 4, to: [1, 7, 2] },
      { t: 21_000, kind: "smoke-break", from: 7, to: [1, 2, 3] },
      { t: 33_000, kind: "exemption", from: 7, to: [7] },
      { t: 34_000, kind: "extra-paperwork", from: 5, to: [7] },
      { t: 44_000, kind: "exemption", from: 5, to: [5] },
    ];
    const ledger = events.reduce((l, e) => record(l, DESK, e), EMPTY_LEDGER);
    const tally = tallyBonuses(DESK, ledger.log);
    const sum = (xs: { count: number }[]) => xs.reduce((n, x) => n + x.count, 0);
    expect(sum(tally.sent)).toBe(ledger.sent);
    expect(sum(tally.received)).toBe(ledger.received);
  });

  it("BONUS_KINDS is the three catch-up cards", () => {
    expect(BONUS_KINDS).toEqual(["extra-paperwork", "exemption", "smoke-break"]);
  });
});

describe("parseBonusLog (#864 C1)", () => {
  it("keeps well-formed entries and drops the rest (a stored Json column)", () => {
    expect(
      parseBonusLog([
        { t: 1, kind: "exemption", from: 7, to: 7 },
        { t: 2, kind: "teleport", from: 7, to: 3 },
        { t: "x", kind: "exemption", from: 7, to: 7 },
        null,
      ]),
    ).toEqual([{ t: 1, kind: "exemption", from: 7, to: 7 }]);
    expect(parseBonusLog(null)).toEqual([]);
    expect(parseBonusLog({ t: 1 })).toEqual([]);
  });
});

describe("personalFrom (#864 C1)", () => {
  const row = {
    desk: 7,
    place: 3,
    cleanWpm: 47.8,
    accuracy: 0.92,
    status: "LINE_CUT" as const,
    suspicious: true,
    bonusLog: [
      { t: 1, kind: "exemption", from: 7, to: 7 },
      { t: 2, kind: "smoke-break", from: 2, to: 7 },
    ],
  };

  it("carries the place, the clean WPM, accuracy, status, the flag and the tallies", () => {
    expect(personalFrom(row)).toEqual({
      desk: 7,
      place: 3,
      wpm: 47.8,
      accuracy: 0.92,
      status: "LINE_CUT",
      suspicious: true,
      bonuses: {
        sent: [{ kind: "exemption", count: 1 }],
        received: [{ kind: "smoke-break", count: 1 }],
      },
    });
  });

  it("never carries the log itself", () => {
    expect(personalFrom(row)).not.toHaveProperty("bonusLog");
    expect(JSON.stringify(personalFrom(row))).not.toContain('"t"');
  });
});
