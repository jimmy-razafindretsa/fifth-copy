import { beforeEach, describe, expect, it, vi } from "vitest";

// Contract of #561 C1: `getRaceSeat(id)` resolves a Race.id (through Race.lobbyId) or a lobby id to
// `{ lobbyId, code }`, `null` otherwise, and parses the id before any query. In-memory Race and Lobby
// tables stand in for Prisma (the select shapes are the ones the query asks for).
type LobbyRow = { id: string; code: string; hostUserId: string };
type RaceRow = { id: string; lobbyId: string | null };

const state = vi.hoisted(() => ({
  lobbies: [] as LobbyRow[],
  races: [] as RaceRow[],
  viewer: null as { id: string } | null,
  proofs: new Set<string>(),
}));

const lobbyFind = vi.fn(async ({ where }: { where: { id: string } }) => {
  const row = state.lobbies.find((l) => l.id === where.id);
  return row ? { id: row.id, code: row.code, hostUserId: row.hostUserId } : null;
});
const raceFind = vi.fn(async ({ where }: { where: { id: string } }) => {
  const row = state.races.find((r) => r.id === where.id);
  if (!row) return null;
  const lobby = state.lobbies.find((l) => l.id === row.lobbyId) ?? null;
  return { lobby: lobby && { id: lobby.id, code: lobby.code, hostUserId: lobby.hostUserId } };
});

vi.mock("@/server/db", () => ({
  db: { lobby: { findUnique: lobbyFind }, race: { findUnique: raceFind } },
}));

vi.mock("@/server/auth", () => ({ getViewer: async () => state.viewer }));
vi.mock("@/server/room-code-proof", () => ({
  codeProofStore: () => ({
    holds: async (user: string, lobby: string) => state.proofs.has(`${user}:${lobby}`),
  }),
}));

const { getRaceSeat } = await import("./get-race-seat");

// Real id shapes: Prisma cuid() lobby ids, race-server uuid v4 race ids.
const LOBBY = { id: "cmuvut8r2000106r7wf01vr30", code: "KGB-4821", hostUserId: "usr_host" };
const ORPHAN_LOBBY_ID = "cmuvumv5q002f0fr7b6mgzfcf";
const RACE_ID = "3b241101-e2bb-4255-8caf-4136c566a962";
const ORPHAN_RACE_ID = "9c5b94b1-35ad-49bb-b118-8e8fc24abf80";
const UNKNOWN_RACE_ID = "16fd2706-8baf-433b-82eb-8c7fada847da";

beforeEach(() => {
  lobbyFind.mockClear();
  raceFind.mockClear();
  state.lobbies = [LOBBY];
  state.viewer = { id: "usr_host" };
  state.proofs = new Set();
  // the second race outlived its lobby (Race.lobbyId SetNull, #572)
  state.races = [
    { id: RACE_ID, lobbyId: LOBBY.id },
    { id: ORPHAN_RACE_ID, lobbyId: null },
  ];
});

describe("getRaceSeat (#561 C1)", () => {
  it.each([
    ["an existing Race.id, through Race.lobbyId", RACE_ID, { lobbyId: LOBBY.id, code: LOBBY.code }],
    ["an existing lobby id", LOBBY.id, { lobbyId: LOBBY.id, code: LOBBY.code }],
    ["an unknown race id", UNKNOWN_RACE_ID, null],
    ["an unknown lobby id", ORPHAN_LOBBY_ID, null],
    ["a race whose lobby is gone", ORPHAN_RACE_ID, null],
  ])("%s", async (_, id, expected) => {
    await expect(getRaceSeat(id)).resolves.toEqual(expected);
  });

  it("reads the Race table for a uuid and the Lobby table for a cuid, never both", async () => {
    await getRaceSeat(RACE_ID);
    expect(raceFind).toHaveBeenCalledTimes(1);
    expect(lobbyFind).not.toHaveBeenCalled();
    raceFind.mockClear();
    await getRaceSeat(LOBBY.id);
    expect(lobbyFind).toHaveBeenCalledTimes(1);
    expect(raceFind).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", ""],
    ["a room code", "KGB-4821"],
    ["a path", "../../etc/passwd"],
    ["a uuid that is not v4", "16fd2706-8baf-133b-82eb-8c7fada847da"],
    ["an SQL fragment", "' OR 1=1 --"],
    ["far too long", `c${"a".repeat(5000)}`],
    ["not a string", 42 as unknown as string],
  ])("a malformed id (%s) is null without any query", async (_, id) => {
    await expect(getRaceSeat(id)).resolves.toBeNull();
    expect(lobbyFind).not.toHaveBeenCalled();
    expect(raceFind).not.toHaveBeenCalled();
  });
});

describe("getRaceSeat serves the room code only to its holders (#999 C13)", () => {
  it.each([
    ["no viewer", null, false],
    ["a viewer without the proof (a link holder)", { id: "usr_link" }, false],
    ["a viewer with the proof of another room", { id: "usr_other" }, false],
    ["a viewer who proved this room's code", { id: "usr_proved" }, true],
    ["the room's host", { id: "usr_host" }, true],
  ])("%s", async (_, viewer, served) => {
    state.viewer = viewer;
    state.proofs = new Set(["usr_proved:" + LOBBY.id, "usr_other:cmuvumv5q002f0fr7b6mgzfcf"]);
    const code = served ? LOBBY.code : null;
    await expect(getRaceSeat(RACE_ID)).resolves.toEqual({ lobbyId: LOBBY.id, code });
    await expect(getRaceSeat(LOBBY.id)).resolves.toEqual({ lobbyId: LOBBY.id, code });
  });
});
