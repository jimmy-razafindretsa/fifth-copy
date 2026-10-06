import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bitrateFor,
  clipFiles,
  LOOPS,
  loopSeconds,
  MAX_CLIP_BYTES,
  MAX_POSTER_BYTES,
  nextTake,
  ORBIT_SECONDS,
  POSTER,
  TARGET_BYTES,
  validateInputs,
  validateOutputs,
} from "./record-live-feed";

// #552 C2 C3 C7: the loop table, the bitrate maths and the --check validators (no browser here).
describe("record-live-feed loops", () => {
  it("records one 8-20 s loop per view, FREE VIEW being one full orbit", () => {
    expect(LOOPS.map((l) => l.view)).toEqual(["over", "pov", "auto"]);
    for (const loop of LOOPS) expect(loopSeconds(loop)).toBeGreaterThanOrEqual(8);
    for (const loop of LOOPS) expect(loopSeconds(loop)).toBeLessThanOrEqual(20);
    expect(ORBIT_SECONDS).toBe(16);
    expect(LOOPS.find((l) => l.view === "auto")!.segments.map((s) => s.view)).toEqual([
      "over",
      "pov",
    ]);
  });

  it("names an mp4 and a webm per view", () => {
    expect(clipFiles()).toEqual([
      "over.mp4",
      "over.webm",
      "pov.mp4",
      "pov.webm",
      "auto.mp4",
      "auto.webm",
    ]);
  });
});

describe("bitrate", () => {
  it("puts the clip at the target size", () => {
    expect(bitrateFor(16)).toBe(Math.floor((TARGET_BYTES * 8) / 16));
    expect(bitrateFor(16, TARGET_BYTES, 0.5)).toBe(Math.floor((TARGET_BYTES * 8) / 32));
  });

  it("retakes lower when over budget, again when late, once higher when far under", () => {
    expect(nextTake(MAX_CLIP_BYTES + 1, 0, 1)).toBeCloseTo(0.85);
    expect(nextTake(TARGET_BYTES, 9, 0.85)).toBe(0.85);
    expect(nextTake(TARGET_BYTES / 2, 0, 1)).toBe(2);
    expect(nextTake(TARGET_BYTES / 2, 0, 2)).toBeNull();
    expect(nextTake(TARGET_BYTES, 0, 1)).toBeNull();
  });
});

describe("validateOutputs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-feed-"));
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom")]);
  const webm = Buffer.from("1a45dfa3", "hex");
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);

  it("reports missing files", () => {
    expect(validateOutputs(dir)).toContain("over.mp4: missing");
  });

  it("accepts the right containers within budget and flags the rest", () => {
    for (const f of clipFiles())
      fs.writeFileSync(path.join(dir, f), f.endsWith("mp4") ? mp4 : webm);
    fs.writeFileSync(path.join(dir, POSTER), webp);
    expect(validateOutputs(dir)).toEqual([]);
    fs.writeFileSync(path.join(dir, "pov.webm"), mp4);
    fs.writeFileSync(path.join(dir, POSTER), Buffer.concat([webp, Buffer.alloc(MAX_POSTER_BYTES)]));
    expect(validateOutputs(dir)).toEqual([
      "pov.webm: not a webm file",
      `${POSTER}: ${webp.length + MAX_POSTER_BYTES} bytes > ${MAX_POSTER_BYTES}`,
    ]);
  });
});

describe("committed feed", () => {
  it("is recorded from the current scene and within budget (C3, C7)", () => {
    expect(validateInputs(process.cwd())).toEqual([]);
    expect(validateOutputs(path.join(process.cwd(), "public/media/live-feed"))).toEqual([]);
  });
});
