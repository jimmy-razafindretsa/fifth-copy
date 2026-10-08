import { describe, expect, it } from "vitest";
import { roleFor } from "./role";

describe("roleFor (#187)", () => {
  const lobby = { hostUserId: "usr_host" };
  it.each([
    ["usr_host", undefined, "host"],
    ["usr_other", undefined, "player"],
    ["usr_host", { spectator: false }, "host"],
    ["usr_host", { spectator: true }, "spectator"],
    ["usr_other", { spectator: true }, "spectator"],
  ] as const)("%s with %j is %s", (viewer, opts, role) => {
    expect(roleFor(lobby, viewer, opts)).toBe(role);
  });
});
