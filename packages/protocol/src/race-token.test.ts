import { describe, expect, it } from "vitest";
import { RACE_TOKEN_TTL_S, raceTokenClaimsSchema } from "./index";

const example = { v: 2, sub: "usr_1", name: "Ada", lobby: "lob_1", role: "host" };

describe("race token claims", () => {
  it("lives 5 minutes", () => {
    expect(RACE_TOKEN_TTL_S).toBe(300);
  });

  it.each([
    ["documented example", example, true],
    ["player role", { ...example, role: "player" }, true],
    ["v: 1", { ...example, v: 1 }, false],
    ["missing lobby", { v: 2, sub: "usr_1", name: "Ada", role: "host" }, false],
    ["wrong role", { ...example, role: "spectator" }, false],
  ])("raceTokenClaimsSchema: %s", (_, payload, ok) => {
    expect(raceTokenClaimsSchema.safeParse(payload).success).toBe(ok);
  });
});
