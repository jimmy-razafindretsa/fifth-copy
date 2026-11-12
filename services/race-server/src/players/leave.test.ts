import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RACE_SETTINGS, deskIdentity, type Member } from "@fifth-copy/protocol";
import type { LeaveResult, RaceDesk, RoomState } from "../rooms/registry";
import { leaveRoom, releaseDropped, type LeaveDeps } from "./leave";

// #143 C3 (and #658): who leaves after a race, and what the process frees, with fakes for the
// registry and presence (the Redis side is registry.test.ts, the wire side lifecycle.test.ts).

const bot: Member = {
  desk: 3,
  name: "Bot",
  isHost: false,
  isBot: true,
  ...deskIdentity(3),
  avatar: null,
};
const desks: RaceDesk[] = [
  { desk: 1, userId: "host", name: "Ada", isBot: false },
  { desk: 2, userId: "b", name: "Bob", isBot: false },
  { desk: 3, userId: null, name: "Bot", isBot: true },
];

function deps({
  phase = "ended",
  result = () => ({ members: [], closed: false, kept: false }),
  dropped = [],
  sockets = {},
  watching = false,
}: {
  phase?: RoomState["phase"];
  result?: (userId: string) => LeaveResult;
  dropped?: string[];
  sockets?: Record<string, number>;
  /** The host watches (#876): no desk of its own. */
  watching?: boolean;
} = {}) {
  const seated = watching ? desks.filter((d) => d.userId !== "host") : desks;
  const room: RoomState = {
    code: "ABCD",
    hostUserId: "host",
    phase,
    settings: { ...DEFAULT_RACE_SETTINGS, hostWatches: watching },
    race: null,
    endAt: null,
    seated,
    desks: seated,
    raceId: "r1",
    endReason: null,
    autoStartAt: null,
  };
  const leave = vi.fn(async (_lobbyId: string, userId: string) => result(userId));
  const d = {
    registry: {
      leave,
      room: async () => room,
      withRoom: <T>(_lobbyId: string, fn: () => Promise<T>) => fn(),
    },
    presence: {
      left: vi.fn(async () => {}),
      sockets: (_lobbyId: string, userId: string) => sockets[userId] ?? 0,
      dropped: () => dropped,
    },
    onRoomClosed: vi.fn(),
    onLobbyClosed: vi.fn(),
    announce: vi.fn(),
    announceSettings: vi.fn(),
    onNewHost: vi.fn(),
  } satisfies LeaveDeps;
  return d;
}

describe("leaveRoom (#143)", () => {
  it("the last human leaving an ended room (kept): the process frees the room, the roster goes out", async () => {
    const d = deps({ result: () => ({ members: [bot], closed: false, kept: true }) });
    expect(await leaveRoom(d, "lob", "host")).toEqual({
      members: [bot],
      closed: false,
      kept: true,
    });
    expect(d.onRoomClosed).toHaveBeenCalledWith("lob");
    expect(d.announce).toHaveBeenCalledWith("lob", [bot]);
  });

  it("a closed room is freed and announces nothing; a plain leave announces and frees nothing", async () => {
    const closed = deps({ result: () => ({ members: [], closed: true, kept: false }) });
    await leaveRoom(closed, "lob", "host");
    expect(closed.onRoomClosed).toHaveBeenCalledOnce();
    expect(closed.announce).not.toHaveBeenCalled();

    const plain = deps({ result: () => ({ members: [bot], closed: false, kept: false }) });
    await leaveRoom(plain, "lob", "b");
    expect(plain.onRoomClosed).not.toHaveBeenCalled();
    expect(plain.presence.left).toHaveBeenCalledWith("lob", "b");
    expect(plain.announce).toHaveBeenCalledWith("lob", [bot]);
  });
});

describe("leaveRoom hands the host role over (#137 C2, C3)", () => {
  it("a leave that promotes a new host announces the roster first, then reports the new host once", async () => {
    const promoted = { ...bot, userId: "a", isBot: false, isHost: true };
    const d = deps({
      phase: "waiting",
      result: () => ({
        members: [promoted],
        closed: false,
        kept: false,
        newHost: { userId: "a", desk: 1 },
      }),
    });
    const order: string[] = [];
    d.announce.mockImplementation(() => void order.push("announce"));
    d.onNewHost.mockImplementation(() => void order.push("new-host"));
    await leaveRoom(d, "lob", "host");
    expect(d.onNewHost).toHaveBeenCalledExactlyOnceWith("lob", { userId: "a", desk: 1 });
    expect(order).toEqual(["announce", "new-host"]);
  });

  it("#884 C3 an explicit leave by the host in a waiting room promotes at once: no grace (only a disconnect waits one)", async () => {
    const d = deps({
      phase: "waiting",
      result: () => ({
        members: [{ ...bot, userId: "a", isBot: false, isHost: true }],
        closed: false,
        kept: false,
        newHost: { userId: "a", desk: 1 },
      }),
    });
    // the host has no socket left and no timer runs: the role passes inside the leave itself
    await leaveRoom(d, "lob", "host");
    expect(d.registry.leave).toHaveBeenCalledExactlyOnceWith("lob", "host");
    expect(d.onNewHost).toHaveBeenCalledExactlyOnceWith("lob", { userId: "a", desk: 1 });
  });

  it("a leave without a promotion (a guest, a closing room) reports no new host", async () => {
    const plain = deps({ result: () => ({ members: [bot], closed: false, kept: false }) });
    await leaveRoom(plain, "lob", "b");
    const closed = deps({
      phase: "waiting",
      result: () => ({ members: [], closed: true, kept: false }),
    });
    await leaveRoom(closed, "lob", "host");
    expect(plain.onNewHost).not.toHaveBeenCalled();
    expect(closed.onNewHost).not.toHaveBeenCalled();
  });
});

describe("leaveRoom closes the lobby (#734 C2)", () => {
  it("the leave that closes the room queues the lobby close, once, after freeing it", async () => {
    const d = deps({
      phase: "waiting",
      result: () => ({ members: [], closed: true, kept: false }),
    });
    await leaveRoom(d, "lob", "host");
    expect(d.onLobbyClosed).toHaveBeenCalledExactlyOnceWith("lob");
    expect(d.onRoomClosed).toHaveBeenCalledOnce();
  });

  it("a kept ended room (Race again) and a plain leave never close the lobby", async () => {
    const kept = deps({ result: () => ({ members: [bot], closed: false, kept: true }) });
    await leaveRoom(kept, "lob", "host");
    expect(kept.onLobbyClosed).not.toHaveBeenCalled();
    const plain = deps({ result: () => ({ members: [bot], closed: false, kept: false }) });
    await leaveRoom(plain, "lob", "b");
    expect(plain.onLobbyClosed).not.toHaveBeenCalled();
  });

  it("a web outage never blocks the leave: the close is fire and forget", async () => {
    const d = deps({
      phase: "waiting",
      result: () => ({ members: [], closed: true, kept: false }),
    });
    // An enqueue that never settles (Redis or web stalled) still lets the leave resolve.
    d.onLobbyClosed.mockImplementation(() => void new Promise(() => {}));
    await expect(leaveRoom(d, "lob", "host")).resolves.toMatchObject({ closed: true });
  });
});

describe("releaseDropped after the end (#658, #143 C3)", () => {
  it("releases every dropped member with no socket, so the next race's desks hold only those present", async () => {
    const d = deps({ dropped: ["b", "host"], sockets: { host: 1 } });
    await releaseDropped(d, "lob");
    expect(d.registry.leave.mock.calls.map(([, userId]) => userId)).toEqual(["b"]);
  });

  it("stops after the leave that keeps the ended room for its members", async () => {
    const d = deps({
      dropped: ["host", "b"],
      result: (userId) =>
        userId === "host"
          ? { members: [bot], closed: false, kept: false }
          : { members: [bot], closed: false, kept: true },
    });
    await releaseDropped(d, "lob");
    expect(d.registry.leave).toHaveBeenCalledTimes(2);
    expect(d.onRoomClosed).toHaveBeenCalledOnce();
  });

  it("does nothing before the end", async () => {
    const d = deps({ phase: "running", dropped: ["b"] });
    await releaseDropped(d, "lob");
    expect(d.registry.leave).not.toHaveBeenCalled();
  });
});

describe("releaseDropped: the watching host kept for the race (#876 C4)", () => {
  it("leaves after the end through the last-leave grace; the dropped typists leave at once", async () => {
    const d = deps({ watching: true, dropped: ["b", "host"] });
    const deferred: Array<() => Promise<void>> = [];
    const deferLeave = vi.fn((_lobbyId: string, _userId: string, leave: () => Promise<void>) => {
      deferred.push(leave);
    });
    await releaseDropped({ ...d, deferLeave }, "lob");
    expect(d.registry.leave.mock.calls.map(([, userId]) => userId)).toEqual(["b"]);
    expect(deferLeave).toHaveBeenCalledWith("lob", "host", expect.any(Function));
    await deferred[0]!();
    expect(d.registry.leave.mock.calls.map(([, userId]) => userId)).toEqual(["b", "host"]);
  });

  it("without a grace it leaves at once; back with a socket, or before the end, it stays", async () => {
    const d = deps({ watching: true, dropped: ["host"] });
    await releaseDropped(d, "lob");
    expect(d.registry.leave.mock.calls.map(([, userId]) => userId)).toEqual(["host"]);
    const back = deps({ watching: true, dropped: ["host"], sockets: { host: 1 } });
    await releaseDropped(back, "lob");
    expect(back.registry.leave).not.toHaveBeenCalled();
    const racing = deps({ watching: true, phase: "running", dropped: ["host"] });
    await releaseDropped(racing, "lob");
    expect(racing.registry.leave).not.toHaveBeenCalled();
  });
});
