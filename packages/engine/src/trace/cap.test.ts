import { describe, expect, it } from "vitest";
import { TRACE_ALLOWANCE, TRACE_KEYS_PER_CHAR, traceCapOf } from "./cap";

describe("traceCapOf", () => {
  it.each([
    [0, 1_000],
    [1, 1_004],
    [250, 2_000],
    [20_000, 81_000],
  ])("a %i-character text holds %i keystrokes", (length, cap) => {
    expect(traceCapOf(length)).toBe(cap);
    expect(traceCapOf(length)).toBe(TRACE_KEYS_PER_CHAR * length + TRACE_ALLOWANCE);
  });
});
