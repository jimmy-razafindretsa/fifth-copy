import { afterEach, describe, expect, it, vi } from "vitest";
import { createRedis } from "./client";

describe("createRedis", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is lazy: no connection until asked", () => {
    const redis = createRedis("redis://localhost:6399/0");
    expect(redis.status).toBe("wait");
    redis.disconnect();
  });

  it("rejects connect() on an unreachable server and logs errors without the URL", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void logs.push(line));
    const url = "redis://:s3cret-pass@localhost:6399/0";
    const redis = createRedis(url);
    await expect(redis.connect()).rejects.toThrow();
    redis.disconnect();
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toContain("s3cret-pass");
      expect(line).not.toContain("6399");
      expect(JSON.parse(line)).toMatchObject({ level: "error", msg: "redis error" });
    }
  });
});
