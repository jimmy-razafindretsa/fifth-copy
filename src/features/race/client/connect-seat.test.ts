import { afterEach, describe, expect, it, vi } from "vitest";
import { connectSeat, type MintRaceToken } from "./connect-seat";
import { HANDOFF_MS, parkSocket, releaseParkedSocket } from "./handoff";
import type { RoomSocket } from "./socket";

// #561 C4 (the client leaf's side effects, unit-level): `RaceSeatLive` runs `connectSeat` in an effect.
// It mints the race token through the lobby action, loads the socket module lazily (ADR 0013 budget),
// connects, binds the store, and its cleanup unbinds and closes; a stale mint never opens a socket.
const LOBBY = "cmuvut8r2000106r7wf01vr30";

function fakeRoom() {
  const offs: ReturnType<typeof vi.fn>[] = [];
  const on = () => {
    const off = vi.fn();
    offs.push(off);
    return off;
  };
  const room = {
    onWelcome: vi.fn(on),
    onRoster: vi.fn(on),
    onCountdown: vi.fn(on),
    onSnapshot: vi.fn(on),
    onConnectError: vi.fn(on),
    onReconnecting: vi.fn(on),
    onReconnected: vi.fn(on),
    close: vi.fn(),
  };
  return { room: room as unknown as RoomSocket & typeof room, offs };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("connectSeat (#561 C4)", () => {
  it("mints with the room code, connects to the minted url with the token, binds the store", async () => {
    const { room } = fakeRoom();
    const connectToRoom = vi.fn(() => room);
    const mint = vi.fn<MintRaceToken>(async () => ({ ok: true, token: "tok", url: "http://r" }));
    const dispatch = vi.fn();
    connectSeat({
      code: "KGB-4821",
      lobbyId: LOBBY,
      mint,
      dispatch,
      load: async () => ({ connectToRoom }),
    });
    await vi.waitFor(() => expect(connectToRoom).toHaveBeenCalledTimes(1));
    expect(mint).toHaveBeenCalledWith({ code: "KGB-4821" });
    expect(connectToRoom.mock.calls[0]!.slice(0, 2)).toEqual(["http://r", "tok"]);
    // the store's binding, plus the handoff's own (#214 C2)
    expect(room.onWelcome).toHaveBeenCalledTimes(2);
    expect(room.onCountdown).toHaveBeenCalledTimes(1);
    expect(room.onConnectError).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each(["not-found", "closed"] as const)(
    "a %s mint is a token error, no socket",
    async (error) => {
      const connectToRoom = vi.fn();
      const dispatch = vi.fn();
      connectSeat({
        code: "KGB-4821",
        lobbyId: LOBBY,
        mint: async () => ({ ok: false, error }),
        dispatch,
        load: async () => ({ connectToRoom }),
      });
      await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
      expect(dispatch).toHaveBeenCalledWith({ type: "token-error", error });
      expect(connectToRoom).not.toHaveBeenCalled();
    },
  );

  it("a failed mint request or socket chunk is a generic token error", async () => {
    for (const fail of ["mint", "load"] as const) {
      const dispatch = vi.fn();
      connectSeat({
        code: "KGB-4821",
        lobbyId: LOBBY,
        mint:
          fail === "mint"
            ? () => Promise.reject(new Error("offline"))
            : async () => ({ ok: true, token: "t", url: "u" }),
        dispatch,
        load:
          fail === "load"
            ? () => Promise.reject(new Error("chunk"))
            : async () => ({ connectToRoom: vi.fn() }),
      });
      await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
      expect(dispatch, fail).toHaveBeenCalledWith({ type: "token-error", error: "generic" });
    }
  });

  it("cleanup before the mint answers: no socket, no dispatch (StrictMode's first mount)", async () => {
    const minted = deferred<Awaited<ReturnType<MintRaceToken>>>();
    const connectToRoom = vi.fn();
    const dispatch = vi.fn();
    const stop = connectSeat({
      code: "KGB-4821",
      lobbyId: LOBBY,
      mint: () => minted.promise,
      dispatch,
      load: async () => ({ connectToRoom }),
    });
    stop();
    minted.resolve({ ok: true, token: "t", url: "u" });
    await new Promise((r) => setTimeout(r, 0));
    expect(connectToRoom).not.toHaveBeenCalled();
    // a late failure after cleanup is silent too
    const failed = deferred<Awaited<ReturnType<MintRaceToken>>>();
    connectSeat({
      code: "KGB-4821",
      lobbyId: LOBBY,
      mint: () => failed.promise,
      dispatch,
      load: async () => ({ connectToRoom }),
    })();
    failed.reject(new Error("late"));
    await new Promise((r) => setTimeout(r, 0));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("cleanup after connecting offs every listener and closes the socket", async () => {
    const { room, offs } = fakeRoom();
    const stop = connectSeat({
      code: "KGB-4821",
      lobbyId: LOBBY,
      mint: async () => ({ ok: true, token: "t", url: "u" }),
      dispatch: vi.fn(),
      load: async () => ({ connectToRoom: () => room }),
    });
    await vi.waitFor(() => expect(room.onWelcome).toHaveBeenCalled());
    stop();
    // bindRaceSocket's seven (#214 adds countdown, #559 snapshot) and the handoff's own welcome listener
    expect(offs.length).toBe(8);
    for (const off of offs) expect(off).toHaveBeenCalledTimes(1);
    expect(room.close).toHaveBeenCalledTimes(1);
  });
});

// Contract of #214 C2 (the seat side of the handover): the waiting room parks its socket instead of
// closing it when it moves to the seat view, so the desk is never line-cut in between (the race server
// answers `still-connected` while a second socket of the user is open). `connectSeat` closes the parked
// socket of the same lobby after its own `welcome`, or it closes after 10 s if none comes.
describe("the parked lobby socket (#214 C2)", () => {
  const OTHER = "cmuvumv5q002f0fr7b6mgzfcf";
  const welcome = { resumeKey: null, serverNow: 0, room: { phase: "countdown" }, race: null };
  const parked = () => ({ close: vi.fn() });

  function open(room: RoomSocket) {
    return connectSeat({
      code: "KGB-4821",
      lobbyId: LOBBY,
      mint: async () => ({ ok: true, token: "t", url: "u" }),
      dispatch: vi.fn(),
      load: async () => ({ connectToRoom: () => room }),
    });
  }

  /** Delivers a welcome to every welcome listener bound on the fake room. */
  const welcomeTo = (room: ReturnType<typeof fakeRoom>["room"]) => {
    for (const call of room.onWelcome.mock.calls as unknown as [(p: unknown) => void][]) {
      call[0](welcome);
    }
  };

  it("closes the parked socket of its lobby after its own welcome, and only that one", async () => {
    const lobbySocket = parked();
    const otherLobby = parked();
    parkSocket(LOBBY, lobbySocket);
    parkSocket(OTHER, otherLobby);
    const { room } = fakeRoom();
    const stop = open(room);
    await vi.waitFor(() => expect(room.onWelcome).toHaveBeenCalled());
    expect(lobbySocket.close).not.toHaveBeenCalled();
    welcomeTo(room);
    expect(lobbySocket.close).toHaveBeenCalledTimes(1);
    expect(otherLobby.close).not.toHaveBeenCalled();
    // a later welcome (a reconnect) has nothing left to close
    welcomeTo(room);
    expect(lobbySocket.close).toHaveBeenCalledTimes(1);
    stop();
    expect(room.close).toHaveBeenCalledTimes(1);
    expect(lobbySocket.close).toHaveBeenCalledTimes(1);
    releaseParkedSocket(OTHER);
    expect(otherLobby.close).toHaveBeenCalledTimes(1);
  });

  it("without a welcome the parked socket closes after 10 s", async () => {
    vi.useFakeTimers();
    const lobbySocket = parked();
    parkSocket(LOBBY, lobbySocket);
    const { room } = fakeRoom();
    const stop = open(room);
    await vi.advanceTimersByTimeAsync(0);
    expect(room.onWelcome).toHaveBeenCalled();
    expect(HANDOFF_MS).toBe(10_000);
    await vi.advanceTimersByTimeAsync(HANDOFF_MS - 1);
    expect(lobbySocket.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(lobbySocket.close).toHaveBeenCalledTimes(1);
    // the welcome after the fallback closes nothing twice
    welcomeTo(room);
    expect(lobbySocket.close).toHaveBeenCalledTimes(1);
    stop();
  });

  it("a cleanup before the welcome (StrictMode's first mount) leaves the parked socket open", async () => {
    vi.useFakeTimers();
    const lobbySocket = parked();
    parkSocket(LOBBY, lobbySocket);
    const first = fakeRoom();
    open(first.room)();
    await vi.advanceTimersByTimeAsync(0);
    expect(lobbySocket.close).not.toHaveBeenCalled();
    const second = fakeRoom();
    const stop = open(second.room);
    await vi.advanceTimersByTimeAsync(0);
    welcomeTo(second.room);
    expect(lobbySocket.close).toHaveBeenCalledTimes(1);
    stop();
  });

  it("parking a second socket for the same lobby closes the first", () => {
    vi.useFakeTimers();
    const a = parked();
    const b = parked();
    parkSocket(LOBBY, a);
    parkSocket(LOBBY, b);
    expect(a.close).toHaveBeenCalledTimes(1);
    expect(b.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HANDOFF_MS);
    expect(b.close).toHaveBeenCalledTimes(1);
    expect(a.close).toHaveBeenCalledTimes(1);
  });
});
