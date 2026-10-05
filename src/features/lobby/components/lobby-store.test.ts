import { describe, expect, it, vi } from "vitest";
import type { Member } from "@fifth-copy/protocol";
import type { ConnectErrorReason, RoomEvents, RoomSocket } from "@/features/race";
import { bindRoomSocket, initialLobbyState, reduceLobby, type LobbyEvent } from "./lobby-store";

// Contract of card 107, C5: the lobby store reduces `welcome` and `roster` into a desk-sorted list.
const ada: Member = { desk: 1, name: "Ada", isHost: true };
const bob: Member = { desk: 2, name: "Bob", isHost: false };
const cyd: Member = { desk: 5, name: "Cyd", isHost: false };

const welcome = (you: number, members: Member[]): RoomEvents["welcome"] => ({
  v: 2,
  you,
  room: { code: "KGB-4821" as never, phase: "waiting" },
  members,
});

function run(...events: LobbyEvent[]) {
  return events.reduce(reduceLobby, initialLobbyState);
}

/** A fake `RoomSocket`: collects the callbacks the store binds, so a test can fire them. */
function fakeSocket() {
  const cbs: Partial<Record<string, (arg: never) => void>> = {};
  const socket: RoomSocket = {
    onWelcome: (cb) => void (cbs.welcome = cb as never),
    onRoster: (cb) => void (cbs.roster = cb as never),
    onProtocolError: (cb) => void (cbs.protocolError = cb as never),
    onConnectError: (cb) => void (cbs.connectError = cb as never),
    onReconnecting: (cb) => void (cbs.reconnecting = cb as never),
    onReconnected: (cb) => void (cbs.reconnected = cb as never),
    close: vi.fn(),
  };
  const fire = (name: string, arg: unknown) => cbs[name]?.(arg as never);
  return { socket, cbs, fire };
}

describe("reduceLobby", () => {
  it("starts loading with no members", () => {
    expect(initialLobbyState).toEqual({ phase: "loading", error: null, you: null, members: [] });
  });

  it("welcome sets the viewer's desk and sorts members by desk", () => {
    const state = run({ type: "welcome", payload: welcome(2, [cyd, bob, ada]) });
    expect(state).toEqual({ phase: "live", error: null, you: 2, members: [ada, bob, cyd] });
  });

  it("roster replaces the list and keeps the viewer's desk", () => {
    const state = run(
      { type: "welcome", payload: welcome(2, [ada, bob]) },
      { type: "roster", payload: { v: 2, members: [cyd, ada] } },
    );
    expect(state.members).toEqual([ada, cyd]);
    expect(state.you).toBe(2);
  });

  it.each([
    ["closed", "closed"],
    ["no-room", "not-found"],
    ["bad-token", "generic"],
    ["version", "generic"],
  ] as const)("connect-error %s is a terminal %s error", (reason, error) => {
    const state = run(
      { type: "welcome", payload: welcome(1, [ada]) },
      { type: "connect-error", reason },
      { type: "reconnected" },
      { type: "roster", payload: { v: 2, members: [ada, bob] } },
    );
    expect(state.phase).toBe("error");
    expect(state.error).toBe(error);
  });

  it("a transport error or a reconnect attempt shows reconnecting, keeping the list", () => {
    const live = run({ type: "welcome", payload: welcome(1, [ada, bob]) });
    for (const event of [
      { type: "connect-error", reason: "transport" },
      { type: "reconnecting" },
    ] as const) {
      const state = reduceLobby(live, event);
      expect(state.phase).toBe("reconnecting");
      expect(state.members).toEqual([ada, bob]);
    }
  });

  it("reconnected and the next welcome bring the room back live", () => {
    const state = run(
      { type: "welcome", payload: welcome(1, [ada]) },
      { type: "reconnecting" },
      { type: "reconnected" },
    );
    expect(state.phase).toBe("live");
  });

  it("a token error is terminal", () => {
    expect(run({ type: "token-error", error: "closed" })).toMatchObject({
      phase: "error",
      error: "closed",
    });
  });
});

describe("bindRoomSocket", () => {
  it("subscribes the socket's events and dispatches them as lobby events", () => {
    const { socket, cbs, fire } = fakeSocket();
    const dispatch = vi.fn();
    bindRoomSocket(socket, dispatch);
    expect(Object.keys(cbs).sort()).toEqual(
      ["connectError", "reconnected", "reconnecting", "roster", "welcome"].sort(),
    );

    const w = welcome(1, [ada]);
    fire("welcome", w);
    fire("roster", { v: 2, members: [ada, bob] });
    fire("connectError", "transport" satisfies ConnectErrorReason);
    fire("reconnecting", 1);
    fire("reconnected", 1);
    expect(dispatch.mock.calls.map(([e]) => e)).toEqual([
      { type: "welcome", payload: w },
      { type: "roster", payload: { v: 2, members: [ada, bob] } },
      { type: "connect-error", reason: "transport" },
      { type: "reconnecting" },
      { type: "reconnected" },
    ]);
  });

  it("feeds a reducer end to end", () => {
    const { socket, fire } = fakeSocket();
    let state = initialLobbyState;
    bindRoomSocket(socket, (event) => (state = reduceLobby(state, event)));
    fire("welcome", welcome(2, [bob]));
    fire("roster", { v: 2, members: [bob, ada] });
    expect(state).toEqual({ phase: "live", error: null, you: 2, members: [ada, bob] });
  });
});
