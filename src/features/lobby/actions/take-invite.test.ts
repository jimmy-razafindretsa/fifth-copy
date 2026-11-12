import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RedeemInviteResult } from "../types";

// #809 C2, C3: the TAKE YOUR DESK form post calls redeemInvite once and redirects to /lobby/<code>
// (replacing the invite page); every miss is an outcome the refusal screen renders.
const state = vi.hoisted(() => ({ result: null as unknown, tokens: [] as string[] }));
vi.mock("./redeem-invite", () => ({
  redeemInvite: async ({ token }: { token: string }) => {
    state.tokens.push(token);
    return state.result;
  },
}));
vi.mock("next/navigation", () => ({
  RedirectType: { replace: "replace", push: "push" },
  redirect: (url: string, type: string) => {
    throw new Error(`REDIRECT ${type} ${url}`);
  },
}));

const { takeInvite } = await import("./take-invite");
const TOKEN = "A".repeat(43);
const form = (token?: string) => {
  const f = new FormData();
  if (token !== undefined) f.set("token", token);
  return f;
};
const take = (result: RedeemInviteResult, token = TOKEN) => {
  state.result = result;
  return takeInvite({ outcome: null }, form(token));
};

describe("takeInvite (#809 C2, C3)", () => {
  beforeEach(() => {
    state.tokens = [];
  });

  it("a redeemed token redirects to the lobby, replacing the invite page", async () => {
    await expect(take({ ok: true, code: "KGB-4821" as never })).rejects.toThrow(
      "REDIRECT replace /lobby/KGB-4821",
    );
    expect(state.tokens).toEqual([TOKEN]);
  });

  it("not on file (used, expired, lost the race) or invalid is refused", async () => {
    await expect(take({ ok: false, error: "not-found" })).resolves.toEqual({ outcome: "refused" });
    await expect(take({ ok: false, error: "invalid" })).resolves.toEqual({ outcome: "refused" });
  });

  it("closed, rate-limited and unavailable keep their own outcome", async () => {
    for (const error of ["closed", "rate-limited", "unavailable"] as const) {
      await expect(take({ ok: false, error })).resolves.toEqual({ outcome: error });
    }
  });

  it("a form without a token is refused without a redeem", async () => {
    await expect(takeInvite({ outcome: null }, form())).resolves.toEqual({ outcome: "refused" });
    expect(state.tokens).toEqual([]);
  });
});
