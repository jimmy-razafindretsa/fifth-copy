import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { BACKSPACE, ENGINE_VERSION, type Keystroke } from "@fifth-copy/engine";
import {
  MAX_RACE_MS,
  PROTOCOL_VERSION,
  type InternalRaceResult,
  type RaceResultsRequest,
} from "@fifth-copy/protocol";

vi.mock("@/server/db", () => ({ db: {} }));
const { decodeTrace, MAX_KEYSTROKE_JSON_BYTES, persistRaceResults } =
  await import("./persist-results");

// #189: the web never trusts a trace's gzip (gzip bomb, count mismatch, foreign JSON).

const trace = (value: unknown, count: number) => ({
  encoding: "gzip+base64" as const,
  data: gzipSync(typeof value === "string" ? value : JSON.stringify(value)).toString("base64"),
  count,
});

const keys: Keystroke[] = [
  { t: 0, key: "b" },
  { t: 120, key: "x" },
  { t: 250, key: BACKSPACE },
];

describe("decodeTrace", () => {
  it("inflates a valid trace to its keystrokes and keeps the bytes as received", () => {
    const sent = trace(keys, 3);
    const decoded = decodeTrace(sent, 1_000);
    expect(decoded?.keystrokes).toEqual(keys);
    expect(decoded?.data.toString("base64")).toBe(sent.data);
    expect(decodeTrace(trace([], 0), 1_000)?.keystrokes).toEqual([]);
  });

  it("refuses a count that does not match, or exceeds the race's trace cap", () => {
    expect(decodeTrace(trace(keys, 2), 1_000)).toBeNull();
    expect(decodeTrace(trace(keys, 4), 1_000)).toBeNull();
    expect(decodeTrace(trace(keys, 3), 2)).toBeNull();
  });

  it("stops inflating a gzip bomb at count * MAX_KEYSTROKE_JSON_BYTES", () => {
    // 64 MiB of spaces compresses to ~64 KiB: a small body that would expand without the cap.
    const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024, 0x20));
    expect(bomb.length).toBeLessThan(128 * 1024);
    const started = Date.now();
    expect(
      decodeTrace({ encoding: "gzip+base64", data: bomb.toString("base64"), count: 10 }, 1_000),
    ).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("refuses bytes that are not gzip, JSON that is not an array, and invalid keystrokes", () => {
    const notGzip = { encoding: "gzip+base64" as const, data: "aGVsbG8=", count: 0 };
    expect(decodeTrace(notGzip, 1_000)).toBeNull();
    expect(decodeTrace(trace("not json", 0), 1_000)).toBeNull();
    expect(decodeTrace(trace({ length: 0 }, 0), 1_000)).toBeNull();
    expect(decodeTrace(trace([{ t: -1, key: "a" }], 1), 1_000)).toBeNull();
    expect(decodeTrace(trace([{ t: 1, key: "ab" }], 1), 1_000)).toBeNull();
  });

  it("MAX_KEYSTROKE_JSON_BYTES fits the largest keystroke the protocol allows", () => {
    const largest = [BACKSPACE, '"', "\\", "€", "é"].map(
      (key) => Buffer.byteLength(JSON.stringify({ t: MAX_RACE_MS, key })) + 1,
    );
    expect(Math.max(...largest)).toBeLessThanOrEqual(MAX_KEYSTROKE_JSON_BYTES);
    const full = Array.from({ length: 500 }, () => ({ t: MAX_RACE_MS, key: BACKSPACE }));
    expect(decodeTrace(trace(full, 500), 1_000)?.keystrokes).toHaveLength(500);
  });
});

describe("persistRaceResults status mapping (#183 C4)", () => {
  it("stores an abandoned desk as REASSIGNED with its frozen progress, an asleep one as ASLEEP", async () => {
    const created: { status: string; progress: number; desk: number }[] = [];
    const tx = {
      race: { updateMany: async () => ({ count: 1 }) },
      raceResult: {
        upsert: async ({ create }: { create: (typeof created)[number] }) =>
          void created.push(create),
      },
      raceKeystrokes: { upsert: async () => undefined },
    };
    const db = {
      race: { findUnique: async () => ({ textContent: "bonjour" }) },
      user: { findMany: async () => [{ id: "usr_1" }, { id: "usr_2" }] },
      $transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
    };
    const result = (desk: number, status: InternalRaceResult["status"], cursor: number) =>
      ({
        desk,
        userId: `usr_${desk}`,
        name: `Clerk ${desk}`,
        isBot: false,
        place: desk,
        status,
        wpm: 10,
        rawWpm: 10,
        cleanWpm: 10,
        adjustedWpm: 10,
        accuracy: 1,
        progress: cursor / 7,
        correct: cursor,
        errors: 0,
        total: cursor,
        durationMs: 1_000,
        finishedAtMs: null,
        bonusesSent: 0,
        bonusesReceived: 0,
        bonusLog: [],
        flags: [],
        engineVersion: ENGINE_VERSION,
        trace: trace([], 0),
      }) satisfies InternalRaceResult;
    const request: RaceResultsRequest = {
      v: PROTOCOL_VERSION,
      raceId: "6f1c2a4e-8b9d-4c3e-9f0a-1b2c3d4e5f60",
      endedAt: 1_767_225_660_000,
      reason: "all-finished",
      lobbySize: 2,
      results: [result(1, "asleep", 2), result(2, "abandoned", 3)],
    };
    const outcome = await persistRaceResults(request, { db: db as never });
    expect(outcome.ok).toBe(true);
    expect(created.map(({ desk, status, progress }) => ({ desk, status, progress }))).toEqual([
      { desk: 1, status: "ASLEEP", progress: 2 / 7 },
      { desk: 2, status: "REASSIGNED", progress: 3 / 7 },
    ]);
  });
});

describe("persistRaceResults flags mapping (#195 C4)", () => {
  it("a result with flags is suspicious with the codes joined by ','; without flags it is not", async () => {
    const created: { desk: number; suspicious: boolean; suspiciousReason: string | null }[] = [];
    const tx = {
      race: { updateMany: async () => ({ count: 1 }) },
      raceResult: {
        upsert: async ({ create }: { create: (typeof created)[number] }) =>
          void created.push(create),
      },
      raceKeystrokes: { upsert: async () => undefined },
    };
    const db = {
      race: { findUnique: async () => ({ textContent: "bonjour" }) },
      user: { findMany: async () => [{ id: "usr_1" }, { id: "usr_2" }] },
      $transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
    };
    const result = (desk: number, flags: InternalRaceResult["flags"]) =>
      ({
        desk,
        userId: `usr_${desk}`,
        name: `Clerk ${desk}`,
        isBot: false,
        place: desk,
        status: "finished",
        wpm: 10,
        rawWpm: 10,
        cleanWpm: 10,
        adjustedWpm: 10,
        accuracy: 1,
        progress: 1,
        correct: 7,
        errors: 0,
        total: 7,
        durationMs: 1_000,
        finishedAtMs: 1_000,
        bonusesSent: 0,
        bonusesReceived: 0,
        bonusLog: [],
        flags,
        engineVersion: ENGINE_VERSION,
        trace: trace([], 0),
      }) satisfies InternalRaceResult;
    const request: RaceResultsRequest = {
      v: PROTOCOL_VERSION,
      raceId: "6f1c2a4e-8b9d-4c3e-9f0a-1b2c3d4e5f60",
      endedAt: 1_767_225_660_000,
      reason: "all-finished",
      lobbySize: 2,
      results: [
        result(1, [{ code: "regular-rhythm", detail: "cv=0;same=1" }, { code: "wpm-cap" }]),
        result(2, []),
      ],
    };
    expect((await persistRaceResults(request, { db: db as never })).ok).toBe(true);
    expect(
      created.map(({ desk, suspicious, suspiciousReason }) => ({
        desk,
        suspicious,
        suspiciousReason,
      })),
    ).toEqual([
      { desk: 1, suspicious: true, suspiciousReason: "regular-rhythm,wpm-cap" },
      { desk: 2, suspicious: false, suspiciousReason: null },
    ]);
  });
});
