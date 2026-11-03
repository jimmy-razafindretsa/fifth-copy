import { afterEach, describe, expect, it, vi } from "vitest";
import { connectSeat, type MintRaceToken } from "./connect-seat";
import { HANDOFF_MS, parkSocket, releaseParkedSocket } from "./handoff";
import type { RoomSocket } from "./socket";
import { bindRaceSocket } from "./store";
import { fakeRoomSocket, type FakeRoomSocket } from "./testing/fake-room-socket";

// #561 C4 (the client leaf's side effects, unit-level): `RaceSeatLive` runs `connectSeat` in an effect.
// It mints the race token through the lobby action, loads the socket module lazily (ADR 0013 budget),
// connects, binds the store, and its cleanup unbinds and closes; a stale mint never opens a socket.
const LOBBY = "cmuvut8r2000106r7wf01vr30";

/** The shared typed fake (#682); `offs` are the `Off`s of every recorded `on*` call. */
function fakeRoom() {
  const room = fakeRoomSocket();
  return { room, offs: room.offs };
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
    const [url, token] = connectToRoom.mock.calls[0] as unknown as [string, () => string];
    expect(url).toBe("http://r");
    // the token is read before every handshake (#235 C6: a re-mint replaces it)
    expect(token()).toBe("tok");
    // the store's binding, the handoff's own (#214 C2) and the issued-key memory (#656)
    expect(room.onWelcome).toHaveBeenCalledTimes(3);
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
    // bindRaceSocket's own listeners (counted on a probe fake, so a new one needs no edit here), plus
    // the handoff's welcome listener (#214 C2) and the issued-key memory's (#656)
    const probe = fakeRoomSocket();
    bindRaceSocket(probe, vi.fn());
    expect(offs.length).toBe(probe.bound.length + 2);
    for (const off of offs) expect(off).toHaveBeenCalledTimes(1);
    expect(room.close).toHaveBeenCalledTimes(1);
  });
});

// Contract of #214 C2 (the seat side of the handover): the waiting room parks its socket instead of
// closing it when it moves to the seat view, so the desk is never line-cut in between (the race server
// answers `still-connected` while a second socket of the user is open). `connectSeat` closes the parked
// socket of the same lobby after its own `welcome`, or it closes after 10 s if none comes.
// #235 C6: a race token lives 300 s (RACE_TOKEN_TTL_S); a reconnect after it expired is refused
// `bad-token`. The seat mints once more (the lobby still lets it), and the same socket reconnects with the
// new token and the stored resume key; the store reads it as reconnecting, not lost.
describe("the re-mint after an expired token (#235 C6)", () => {
  async function seated() {
    const { room } = fakeRoom();
    const connectToRoom = vi.fn((_url: string, _token: string | (() => string)) => room);
    const tokens = ["first", "second", "third"];
    const mint = vi.fn<MintRaceToken>(async () => ({
      ok: true,
      token: tokens.shift()!,
      url: "http://r",
    }));
    const dispatch = vi.fn();
    connectSeat({
      code: "KGB-4821",
      lobbyId: LOBBY,
      mint,
      dispatch,
      load: async () => ({ connectToRoom }),
    });
    await vi.waitFor(() => expect(connectToRoom).toHaveBeenCalledTimes(1));
    const token = connectToRoom.mock.calls[0]![1] as () => string;
    return { room, mint, dispatch, token };
  }

  it("bad-token mints once more and reconnects the same socket with the new token", async () => {
    const { room, mint, dispatch, token } = await seated();
    room.deliver("connectError", "bad-token");
    expect(dispatch).toHaveBeenCalledWith({ type: "reconnecting" });
    expect(dispatch).not.toHaveBeenCalledWith({ type: "connect-error", reason: "bad-token" });
    await vi.waitFor(() => expect(room.reconnect).toHaveBeenCalledTimes(1));
    expect(mint).toHaveBeenCalledTimes(2);
    expect(token()).toBe("second");
  });

  it("a second bad-token before any welcome is lost; after a welcome the next expiry re-mints again", async () => {
    const { room, mint, dispatch } = await seated();
    room.deliver("connectError", "bad-token");
    await vi.waitFor(() => expect(room.reconnect).toHaveBeenCalledTimes(1));
    room.deliver("connectError", "bad-token");
    expect(dispatch).toHaveBeenLastCalledWith({ type: "connect-error", reason: "bad-token" });
    expect(mint).toHaveBeenCalledTimes(2);

    const again = await seated();
    again.room.deliver("connectError", "bad-token");
    await vi.waitFor(() => expect(again.room.reconnect).toHaveBeenCalledTimes(1));
    again.room.deliver("welcome", { resumeKey: null, room: { phase: "running" }, serverNow: 0 });
    again.room.deliver("connectError", "bad-token");
    await vi.waitFor(() => expect(again.room.reconnect).toHaveBeenCalledTimes(2));
    expect(again.mint).toHaveBeenCalledTimes(3);
  });

  it("a refused re-mint is the token error; any other refusal is not re-minted", async () => {
    const { room, mint, dispatch } = await seated();
    mint.mockResolvedValueOnce({ ok: false, error: "closed" });
    room.deliver("connectError", "bad-token");
    await vi.waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({ type: "token-error", error: "closed" }),
    );
    expect(room.reconnect).not.toHaveBeenCalled();

    const other = await seated();
    other.room.deliver("connectError", "no-room");
    expect(other.dispatch).toHaveBeenCalledWith({ type: "connect-error", reason: "no-room" });
    expect(other.mint).toHaveBeenCalledTimes(1);
  });

  it("a cleanup while the re-mint is in flight never reconnects", async () => {
    const { room } = fakeRoom();
    const connectToRoom = vi.fn(() => room);
    const later = deferred<Awaited<ReturnType<MintRaceToken>>>();
    const mint = vi
      .fn<MintRaceToken>()
      .mockResolvedValueOnce({ ok: true, token: "first", url: "http://r" })
      .mockReturnValueOnce(later.promise);
    const dispatch = vi.fn();
    const stop = connectSeat({
      code: "KGB-4821",
      lobbyId: LOBBY,
      mint,
      dispatch,
      load: async () => ({ connectToRoom }),
    });
    await vi.waitFor(() => expect(connectToRoom).toHaveBeenCalledTimes(1));
    room.deliver("connectError", "bad-token");
    stop();
    later.resolve({ ok: true, token: "second", url: "http://r" });
    await Promise.resolve();
    await Promise.resolve();
    expect(room.reconnect).not.toHaveBeenCalled();
  });
});

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
  const welcomeTo = (room: FakeRoomSocket) => room.deliver("welcome", welcome);

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

describe("connectSeat's socket hook (#559)", () => {
  it("hands the open socket to onSocket and runs its off at cleanup, before the socket closes", async () => {
    const { room } = fakeRoom();
    const order: string[] = [];
    room.close.mockImplementation(() => void order.push("close"));
    const onSocket = vi.fn(() => () => void order.push("off"));
    const stop = connectSeat({
      code: "KGB-4821",
      lobbyId: LOBBY,
      mint: async () => ({ ok: true, token: "t", url: "u" }),
      dispatch: vi.fn(),
      load: async () => ({ connectToRoom: () => room }),
      onSocket,
    });
    await vi.waitFor(() => expect(onSocket).toHaveBeenCalledWith(room));
    stop();
    expect(order).toEqual(["off", "close"]);
  });

  it("a cleanup before the socket opens never calls onSocket", async () => {
    const { room } = fakeRoom();
    const minted = deferred<{ ok: true; token: string; url: string }>();
    const onSocket = vi.fn(() => () => {});
    const stop = connectSeat({
      code: "KGB-4821",
      lobbyId: LOBBY,
      mint: () => minted.promise,
      dispatch: vi.fn(),
      load: async () => ({ connectToRoom: () => room }),
      onSocket,
    });
    stop();
    minted.resolve({ ok: true, token: "t", url: "u" });
    await new Promise((r) => setTimeout(r, 0));
    expect(onSocket).not.toHaveBeenCalled();
  });
});
