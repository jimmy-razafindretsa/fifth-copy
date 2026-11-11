import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, RACE_TOKEN_TTL_S, raceTokenClaimsSchema } from "./index";

const example = { v: PROTOCOL_VERSION, sub: "usr_1", name: "Ada", lobby: "lob_1", role: "host" };

describe("race token claims", () => {
  it("lives 5 minutes", () => {
    expect(RACE_TOKEN_TTL_S).toBe(300);
  });

  it.each([
    ["documented example", example, true],
    ["player role", { ...example, role: "player" }, true],
    ["v: 1", { ...example, v: 1 }, false],
    ["missing lobby", { v: PROTOCOL_VERSION, sub: "usr_1", name: "Ada", role: "host" }, false],
    ["spectator role", { ...example, role: "spectator" }, true],
    ["wrong role", { ...example, role: "admin" }, false],
    ["oversize name", { ...example, name: "a".repeat(65) }, false],
    ["oversize lobby", { ...example, lobby: "l".repeat(129) }, false],
    // #730: the approved avatar's version, read by the web at mint; null or absent = none.
    ["avatar version", { ...example, avatar: 3 }, true],
    ["avatar null", { ...example, avatar: null }, true],
    ["avatar 0", { ...example, avatar: 0 }, false],
    ["avatar fractional", { ...example, avatar: 1.5 }, false],
    ["avatar string", { ...example, avatar: "3" }, false],
  ])("raceTokenClaimsSchema: %s", (_, payload, ok) => {
    expect(raceTokenClaimsSchema.safeParse(payload).success).toBe(ok);
  });

  it("reads an absent avatar claim as null (#730)", () => {
    expect(raceTokenClaimsSchema.parse(example).avatar).toBeNull();
  });
});
