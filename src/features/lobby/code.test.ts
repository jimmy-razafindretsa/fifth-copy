import { describe, expect, it, vi } from "vitest";
import { ROOM_CODE_RE } from "@fifth-copy/protocol";
import { generateRoomCode, ROOM_CODE_DRAWS, withUniqueRoomCode } from "./code";

// Deterministic PRNG (mulberry32) so the 10 000 draws are reproducible.
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("generateRoomCode", () => {
  it("C1: 10 000 draws all match ROOM_CODE_RE and never contain I or O", () => {
    const rng = seeded(42);
    for (let i = 0; i < 10_000; i++) {
      const code = generateRoomCode(rng);
      expect(code).toMatch(ROOM_CODE_RE);
      expect(code).not.toMatch(/[IO]/);
    }
  });

  it("C1: is pure, the same rng sequence gives the same code; the extremes stay in range", () => {
    expect(generateRoomCode(seeded(7))).toBe(generateRoomCode(seeded(7)));
    expect(generateRoomCode(() => 0)).toBe("AAA-0000");
    expect(generateRoomCode(() => 0.999_999_9)).toBe("ZZZ-9999");
  });
});

describe("withUniqueRoomCode", () => {
  it("C1: retries when the code is taken and returns the first accepted draw", async () => {
    const tryCreate = vi.fn(async (code: string) => (tryCreate.mock.calls.length === 1 ? null : code));
    const result = await withUniqueRoomCode(seeded(1), tryCreate);
    expect(tryCreate).toHaveBeenCalledTimes(2);
    expect(result).toBe(tryCreate.mock.calls[1]![0]);
  });

  it(`gives up after ${ROOM_CODE_DRAWS} taken draws`, async () => {
    const tryCreate = vi.fn(async () => null);
    await expect(withUniqueRoomCode(seeded(1), tryCreate)).rejects.toThrow("No free room code");
    expect(tryCreate).toHaveBeenCalledTimes(ROOM_CODE_DRAWS);
  });
});
