import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLobby } from "./create-lobby";
import { createPracticeLobby } from "./create-practice-lobby";
import { DEFAULT_PRACTICE_BOTS } from "../practice";

// Contract of #367 C1: the practice entry is createLobby with a private room and default bots.
// createLobby itself (guest creation, room opening, result type) is covered by create-lobby.test.ts.
vi.mock("./create-lobby", () => ({ createLobby: vi.fn() }));

beforeEach(() => {
  vi.mocked(createLobby).mockReset();
  vi.mocked(createLobby).mockResolvedValue({ ok: true, code: "KGB-4821" as never });
});

describe("createPracticeLobby (#367 C1)", () => {
  it("defaults to two bots, clerk and officer, in a private room", async () => {
    expect(DEFAULT_PRACTICE_BOTS).toEqual([{ level: "clerk" }, { level: "officer" }]);
    const result = await createPracticeLobby();
    expect(result).toEqual({ ok: true, code: "KGB-4821" });
    expect(createLobby).toHaveBeenCalledWith({
      settings: { lobbyType: "private", bots: DEFAULT_PRACTICE_BOTS },
    });
  });

  it("keeps the partial's fields and its own bots (#329 extension point)", async () => {
    await createPracticeLobby({
      practiceLetters: ["é"],
      textType: "words",
      bots: [{ level: "major" }],
    });
    expect(createLobby).toHaveBeenCalledWith({
      settings: {
        practiceLetters: ["é"],
        textType: "words",
        bots: [{ level: "major" }],
        lobbyType: "private",
      },
    });
  });

  it("keeps an explicit empty bot list", async () => {
    await createPracticeLobby({ bots: [] });
    expect(createLobby).toHaveBeenCalledWith({ settings: { bots: [], lobbyType: "private" } });
  });

  it.each([
    ["a lobbyType (Postgres-owned, never a patch field)", { lobbyType: "public" }],
    ["an unknown key", { evil: true }],
    ["an out-of-range field", { wordCount: 5 }],
    ["too many bots", { bots: Array.from({ length: 30 }, () => ({ level: "clerk" })) }],
    ["a non-object", "bots"],
  ])("refuses %s with invalid-settings and creates nothing", async (_, partial) => {
    expect(await createPracticeLobby(partial)).toEqual({ ok: false, error: "invalid-settings" });
    expect(createLobby).not.toHaveBeenCalled();
  });

  it("passes createLobby's failure through unchanged", async () => {
    vi.mocked(createLobby).mockResolvedValue({ ok: false, error: "race-server-unavailable" });
    expect(await createPracticeLobby()).toEqual({ ok: false, error: "race-server-unavailable" });
  });
});
