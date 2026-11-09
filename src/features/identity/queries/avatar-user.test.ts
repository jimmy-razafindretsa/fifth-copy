import { describe, expect, it } from "vitest";
import { versionOf } from "./avatar-user";

describe("versionOf (#60)", () => {
  it("reads the version of an avatar key", () => {
    expect(versionOf("u_1/1700000000123")).toBe(1_700_000_000_123);
  });
  it.each([null, undefined, "", "u_1/", "u_1/abc", "u_1/0", "u_1/-3"])("%s has none", (key) => {
    expect(versionOf(key)).toBeNull();
  });
});
