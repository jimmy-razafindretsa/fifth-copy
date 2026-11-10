import { describe, expect, it, vi } from "vitest";

// #808 C2: an invite token is 32 bytes from crypto.randomBytes, base64url without padding (43
// characters); INVITE_TOKEN_RE is the one parser the actions and the route share.
const randomBytes = vi.hoisted(() => vi.fn());
vi.mock("node:crypto", async (orig) => {
  const real = await orig<typeof import("node:crypto")>();
  randomBytes.mockImplementation((n: number) => real.randomBytes(n));
  return { ...real, randomBytes, default: { ...real, randomBytes } };
});

const { INVITE_TOKEN_RE, inviteTokenSchema, newInviteToken } = await import("./invite-token");

describe("invite token (C2)", () => {
  it("is 32 bytes from crypto.randomBytes, base64url, 43 characters, no padding", () => {
    const token = newInviteToken();
    expect(randomBytes).toHaveBeenCalledWith(32);
    expect(token).toHaveLength(43);
    expect(token).toMatch(INVITE_TOKEN_RE);
    expect(token).not.toContain("=");
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("is fresh on every call", () => {
    const tokens = new Set(Array.from({ length: 200 }, newInviteToken));
    expect(tokens.size).toBe(200);
  });

  it("INVITE_TOKEN_RE accepts exactly 43 base64url characters", () => {
    expect(INVITE_TOKEN_RE.test("A".repeat(43))).toBe(true);
    expect(INVITE_TOKEN_RE.test(`${"a".repeat(41)}-_`)).toBe(true);
    for (const bad of [
      "",
      "A".repeat(42),
      "A".repeat(44),
      `${"A".repeat(42)}=`,
      `${"A".repeat(42)}+`,
      `${"A".repeat(42)}/`,
      `${"A".repeat(42)}*`,
      ` ${"A".repeat(43)}`,
      `${"A".repeat(43)}\n`,
      `${"A".repeat(21)}:${"A".repeat(21)}`,
    ]) {
      expect(INVITE_TOKEN_RE.test(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("inviteTokenSchema parses with the same regex and refuses non-strings", () => {
    expect(inviteTokenSchema.safeParse("A".repeat(43)).success).toBe(true);
    for (const bad of [undefined, null, 42, {}, ["A".repeat(43)], "A".repeat(44)]) {
      expect(inviteTokenSchema.safeParse(bad).success).toBe(false);
    }
  });
});
