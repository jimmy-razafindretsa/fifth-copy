import { mulberry32 } from "@fifth-copy/engine";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { limit, requestSubject } from "@/server/limiter";
import { listOpenLobbies } from "../queries/list-open-lobbies";
import { runQuickRace } from "../internal/quick-race";
import { pickRoom } from "../pick-room";
import { DEFAULT_PRACTICE_BOTS, QUICK_RACE_BOTS, quickRaceBots } from "../practice";
import type { OpenLobby } from "../types";
import { createLobby } from "./create-lobby";
import { quickRace } from "./quick-race";

// Contract of #128 C1, C2, C3, C7: QUICK RACE joins the busiest open public room or opens one seated
// with bots. Owner decision 2026-11-04: a new room seats a random 3 to 5 bots, drawn with the
// injected RNG (seeded here). createLobby and listOpenLobbies have their own tests.
vi.mock("./create-lobby", () => ({ createLobby: vi.fn() }));
vi.mock("../queries/list-open-lobbies", () => ({ listOpenLobbies: vi.fn() }));
vi.mock("@/server/limiter", () => ({ limit: vi.fn(), requestSubject: vi.fn() }));

const room = (code: string, typists = 1): OpenLobby => ({ code, typists, bots: 3, seats: 30 });
/** An RNG that always answers `value` (a draw in [0, 1)). */
const fixed = (value: number) => () => value;

beforeEach(() => {
  vi.mocked(createLobby).mockReset();
  vi.mocked(createLobby).mockResolvedValue({ ok: true, code: "NEW-0001" as never });
  vi.mocked(listOpenLobbies).mockReset();
  vi.mocked(listOpenLobbies).mockResolvedValue({ ok: true, lobbies: [] });
  vi.mocked(limit).mockReset();
  vi.mocked(limit).mockResolvedValue({ ok: true, retryAfterMs: 0 });
  vi.mocked(requestSubject).mockReset();
  vi.mocked(requestSubject).mockResolvedValue("ip:203.0.113.7");
});

describe("pickRoom (C1, C7)", () => {
  it("takes the query's first room, in its order", () => {
    const lobbies = [room("AAA-0001", 4), room("BBB-0002", 2)];
    expect(pickRoom(lobbies)).toBe(lobbies[0]);
  });

  it("answers null when no room is open", () => {
    expect(pickRoom([])).toBeNull();
  });
});

describe("QUICK_RACE_BOTS (C2, owner decision 2026-11-04)", () => {
  it("is recruit, clerk, officer, seated 3 to 5 at a time, beside DEFAULT_PRACTICE_BOTS", () => {
    expect(QUICK_RACE_BOTS).toEqual({ min: 3, max: 5, levels: ["recruit", "clerk", "officer"] });
    expect(DEFAULT_PRACTICE_BOTS).toEqual([{ level: "clerk" }, { level: "officer" }]);
  });

  it("draws the count with the injected RNG: 3 at the bottom, 5 at the top, levels in turn", () => {
    expect(quickRaceBots(fixed(0))).toEqual([
      { level: "recruit" },
      { level: "clerk" },
      { level: "officer" },
    ]);
    expect(quickRaceBots(fixed(0.5))).toHaveLength(4);
    expect(quickRaceBots(fixed(0.999_999))).toEqual([
      { level: "recruit" },
      { level: "clerk" },
      { level: "officer" },
      { level: "recruit" },
      { level: "clerk" },
    ]);
  });

  it("a seeded RNG gives the same fill every time, always 3 to 5 bots, and reaches each count", () => {
    expect(quickRaceBots(mulberry32(128))).toEqual(quickRaceBots(mulberry32(128)));
    const rng = mulberry32(7);
    const counts = new Set(Array.from({ length: 200 }, () => quickRaceBots(rng).length));
    expect([...counts].sort()).toEqual([3, 4, 5]);
  });
});

describe("runQuickRace (C1, C7)", () => {
  it("joins the first open room without creating anything", async () => {
    vi.mocked(listOpenLobbies).mockResolvedValue({
      ok: true,
      lobbies: [room("KGB-4821", 3), room("TSR-1917", 1)],
    });
    expect(await runQuickRace(fixed(0))).toEqual({ ok: true, code: "KGB-4821", joined: true });
    expect(createLobby).not.toHaveBeenCalled();
  });

  it("C7 with no open room (full and started rooms are not listed) opens a public room seated with the drawn bots", async () => {
    expect(await runQuickRace(fixed(0))).toEqual({ ok: true, code: "NEW-0001", joined: false });
    expect(createLobby).toHaveBeenCalledExactlyOnceWith({
      settings: {
        lobbyType: "public",
        bots: [{ level: "recruit" }, { level: "clerk" }, { level: "officer" }],
      },
    });
  });

  it("the seeded RNG decides the fill of the created room", async () => {
    await runQuickRace(mulberry32(42));
    expect(createLobby).toHaveBeenCalledWith({
      settings: { lobbyType: "public", bots: quickRaceBots(mulberry32(42)) },
    });
  });

  it("still tries to create when the lookup answers race-server-unavailable", async () => {
    vi.mocked(listOpenLobbies).mockResolvedValue({ ok: false, error: "race-server-unavailable" });
    expect(await runQuickRace(fixed(0))).toEqual({ ok: true, code: "NEW-0001", joined: false });
    expect(createLobby).toHaveBeenCalledOnce();
  });

  it("still tries to create when the lookup throws", async () => {
    vi.mocked(listOpenLobbies).mockRejectedValue(new Error("db down"));
    expect(await runQuickRace(fixed(0))).toEqual({ ok: true, code: "NEW-0001", joined: false });
  });

  it("a failed create returns that result's error", async () => {
    vi.mocked(createLobby).mockResolvedValue({ ok: false, error: "race-server-unavailable" });
    expect(await runQuickRace(fixed(0))).toEqual({ ok: false, error: "race-server-unavailable" });
  });

  it("C7 a joined code is only ever one the query returned", async () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 20; i++) {
      const lobbies = Array.from({ length: i % 4 }, (_, j) => room(`QRY-${i}${j}`.padEnd(8, "0")));
      vi.mocked(listOpenLobbies).mockResolvedValue({ ok: true, lobbies });
      const result = await runQuickRace(rng);
      if (result.ok && result.joined) expect(lobbies.map((l) => l.code)).toContain(result.code);
      else expect(lobbies).toEqual([]);
    }
  });
});

describe("quickRace action (C1, C3)", () => {
  it("checks the quick-race rule for the request subject first, then matchmakes", async () => {
    vi.mocked(listOpenLobbies).mockResolvedValue({ ok: true, lobbies: [room("KGB-4821")] });
    expect(await quickRace()).toEqual({ ok: true, code: "KGB-4821", joined: true });
    expect(limit).toHaveBeenCalledExactlyOnceWith("quick-race", "ip:203.0.113.7");
    expect(vi.mocked(limit).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(listOpenLobbies).mock.invocationCallOrder[0]!,
    );
  });

  it("opens a room with 3 to 5 bots drawn by the server RNG", async () => {
    expect(await quickRace()).toEqual({ ok: true, code: "NEW-0001", joined: false });
    const { settings } = vi.mocked(createLobby).mock.calls[0]![0] as {
      settings: { lobbyType: string; bots: { level: string }[] };
    };
    expect(settings.lobbyType).toBe("public");
    expect(settings.bots.length).toBeGreaterThanOrEqual(3);
    expect(settings.bots.length).toBeLessThanOrEqual(5);
    expect(settings.bots.slice(0, 3)).toEqual(quickRaceBots(fixed(0)));
  });

  it("C3 a refused call returns rate-limited and neither looks up nor creates", async () => {
    vi.mocked(limit).mockResolvedValue({ ok: false, retryAfterMs: 30_000 });
    expect(await quickRace()).toEqual({ ok: false, error: "rate-limited" });
    expect(listOpenLobbies).not.toHaveBeenCalled();
    expect(createLobby).not.toHaveBeenCalled();
  });
});
