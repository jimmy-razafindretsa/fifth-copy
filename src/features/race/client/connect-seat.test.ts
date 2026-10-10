import { afterEach, describe, expect, it, vi } from "vitest";
import { connectSeat, type MintRaceToken } from "./connect-seat";
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

afterEach(() => vi.unstubAllGlobals());

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
    expect(room.onWelcome).toHaveBeenCalledTimes(1);
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
    expect(offs.length).toBe(5);
    for (const off of offs) expect(off).toHaveBeenCalledTimes(1);
    expect(room.close).toHaveBeenCalledTimes(1);
  });
});
