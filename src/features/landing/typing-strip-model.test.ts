import { describe, expect, it } from "vitest";
import { charStates, countErrors, isComplete, verdict, wordsPerMinute } from "./typing-strip-model";
import { drawFeedFacts, timecode } from "./feed";

const T = "Type fast.";

describe("typing strip model (bible 7.7)", () => {
  it("marks done, wrong, next and remaining characters", () => {
    expect(charStates(T, "")).toEqual(["next", ...Array<string>(9).fill("remaining")]);
    expect(charStates(T, "Tyle")).toEqual([
      "done",
      "done",
      "wrong",
      "done",
      "next",
      ...Array<string>(5).fill("remaining"),
    ]);
    expect(charStates(T, T).every((s) => s === "done")).toBe(true);
  });

  it("handles accented sentences by code point", () => {
    const fr = "Écris vite.";
    expect(charStates(fr, "É")[0]).toBe("done");
    expect(charStates(fr, "E")[0]).toBe("wrong");
    expect(countErrors(fr, "Ecris")).toBe(1);
  });

  it("counts errors only over what was typed", () => {
    expect(countErrors(T, "")).toBe(0);
    expect(countErrors(T, "Tyle")).toBe(1);
    expect(countErrors(T, "xxxx")).toBe(4);
  });

  it("computes WPM as (chars / 5) / minutes, rounded, never dividing by zero", () => {
    expect(wordsPerMinute(50, 60_000)).toBe(10);
    expect(wordsPerMinute(22, 5_000)).toBe(53);
    expect(wordsPerMinute(10, 0)).toBe(200);
  });

  it("stamps ACCEPTED with WPM on a clean copy and RETURNED with the error count otherwise", () => {
    expect(verdict(T, "Type fas", 1000)).toBeNull();
    expect(isComplete(T, T)).toBe(true);
    expect(verdict(T, T, 6_000)).toEqual({ kind: "accepted", wpm: 20 });
    expect(verdict(T, "Tyle fast.", 6_000)).toEqual({ kind: "returned", errors: 1 });
  });
});

describe("live feed facts (bible 7.8)", () => {
  it("draws a room between 100 and 999 and up to an hour of stream", () => {
    expect(drawFeedFacts(() => 0)).toEqual({ roomNumber: 100, elapsedSeconds: 0 });
    expect(drawFeedFacts(() => 0.999999)).toEqual({ roomNumber: 999, elapsedSeconds: 3599 });
  });

  it("formats HH:MM:SS", () => {
    expect(timecode(0)).toBe("00:00:00");
    expect(timecode(3725)).toBe("01:02:05");
    expect(timecode(-3)).toBe("00:00:00");
  });
});
