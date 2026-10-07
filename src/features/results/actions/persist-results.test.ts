import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { BACKSPACE, type Keystroke } from "@fifth-copy/engine";
import { MAX_RACE_MS } from "@fifth-copy/protocol";

vi.mock("@/server/db", () => ({ db: {} }));
const { decodeTrace, MAX_KEYSTROKE_JSON_BYTES } = await import("./persist-results");

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
