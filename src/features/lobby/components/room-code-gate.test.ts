import { beforeEach, describe, expect, it, vi } from "vitest";

// #999 C13: the race page's code entry. A malformed code never reaches the server; a match refreshes
// the page (which then serves the code); a refusal is an error line, a throttle or outage the generic one.
const prove = vi.hoisted(() => vi.fn());
vi.mock("../actions/prove-room-code", () => ({ proveRoomCode: prove }));
vi.mock("../actions/join-by-code", () => ({ joinByCode: vi.fn() }));

const { makeGateAction } = await import("./room-code-gate");

const form = (code: string) => {
  const f = new FormData();
  f.set("code", code);
  return f;
};

beforeEach(() => prove.mockReset());

describe("makeGateAction (#999 C13)", () => {
  it("a malformed code is invalid-format with no request", async () => {
    const refresh = vi.fn();
    await expect(makeGateAction("lob_1", refresh)({ error: null }, form("K"))).resolves.toEqual({
      error: "invalid-format",
    });
    expect(prove).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a proven code refreshes the page, sending the page's lobby id with the normalised code", async () => {
    prove.mockResolvedValue({ ok: true });
    const refresh = vi.fn();
    await expect(
      makeGateAction("lob_1", refresh)({ error: null }, form("kgb4821")),
    ).resolves.toEqual({ error: null });
    expect(prove).toHaveBeenCalledWith({ lobbyId: "lob_1", code: "KGB-4821" });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["not-found", "not-found"],
    ["closed", "closed"],
    ["rate-limited", "generic"],
    ["unavailable", "generic"],
  ])("a %s refusal is the %s line, no refresh", async (error, shown) => {
    prove.mockResolvedValue({ ok: false, error });
    const refresh = vi.fn();
    await expect(
      makeGateAction("lob_1", refresh)({ error: null }, form("KGB-4821")),
    ).resolves.toEqual({ error: shown });
    expect(refresh).not.toHaveBeenCalled();
  });
});
