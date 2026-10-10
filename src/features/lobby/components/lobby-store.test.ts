import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  deskIdentity,
  PROTOCOL_VERSION,
  type Member,
} from "@fifth-copy/protocol";
import type { ConnectErrorReason, RoomEvents, RoomSocket } from "@/features/race";
import {
  bindRoomSocket,
  initialLobbyState,
  reduceLobby,
  VERSION_RELOAD_KEY,
  type LobbyEvent,
  type VersionReload,
} from "./lobby-store";

// Contract of card 107, C5: the lobby store reduces `welcome` and `roster` into a desk-sorted list.
// Fixtures of the v4 shape (#557): members carry isBot and their desk identity.
const member = (desk: number, name: string, isHost: boolean): Member => ({
  desk,
  name,
  isHost,
  isBot: false,
  ...deskIdentity(desk),
});
const ada = member(1, "Ada", true);
const bob = member(2, "Bob", false);
const cyd = member(5, "Cyd", false);

const welcome = (you: number, members: Member[]): RoomEvents["welcome"] => ({
  v: PROTOCOL_VERSION,
  role: you === 1 ? "host" : "player",
  you,
  room: { code: "KGB-4821" as never, phase: "waiting" },
  members,
  settings: DEFAULT_RACE_SETTINGS,
  race: null,
  state: null,
  overlay: null,
  resumeKey: null,
  serverNow: 1767225600000,
});

function run(...events: LobbyEvent[]) {
  return events.reduce(reduceLobby, initialLobbyState);
}

/** A fake `RoomSocket`: collects the callbacks the store binds, so a test can fire them. */
function fakeSocket() {
  const cbs: Partial<Record<string, (arg: never) => void>> = {};
  // each on* returns its off (#561); the lobby never unbinds one listener, it closes the socket
  const bind = (name: string) => (cb: unknown) => {
    cbs[name] = cb as never;
    return () => {};
  };
  const socket: RoomSocket = {
    onWelcome: bind("welcome"),
    onRoster: bind("roster"),
    onSettings: bind("settings"),
    sendHostSettings: vi.fn(),
    onProtocolError: bind("protocolError"),
    onConnectError: bind("connectError"),
    onReconnecting: bind("reconnecting"),
    onReconnected: bind("reconnected"),
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
      { type: "roster", payload: { v: PROTOCOL_VERSION, members: [cyd, ada] } },
    );
    expect(state.members).toEqual([ada, cyd]);
    expect(state.you).toBe(2);
  });

  it.each([
    ["closed", "closed"],
    ["no-room", "not-found"],
    ["bad-token", "generic"],
    ["version", "generic"],
    ["in-progress", "generic"],
  ] as const)("connect-error %s is a terminal %s error", (reason, error) => {
    const state = run(
      { type: "welcome", payload: welcome(1, [ada]) },
      { type: "connect-error", reason },
      { type: "reconnected" },
      { type: "roster", payload: { v: PROTOCOL_VERSION, members: [ada, bob] } },
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
    bindRoomSocket(socket, dispatch, fakeReload().deps);
    expect(Object.keys(cbs).sort()).toEqual(
      ["connectError", "reconnected", "reconnecting", "roster", "welcome"].sort(),
    );

    const w = welcome(1, [ada]);
    fire("welcome", w);
    fire("roster", { v: PROTOCOL_VERSION, members: [ada, bob] });
    fire("connectError", "transport" satisfies ConnectErrorReason);
    fire("reconnecting", 1);
    fire("reconnected", 1);
    expect(dispatch.mock.calls.map(([e]) => e)).toEqual([
      { type: "welcome", payload: w },
      { type: "roster", payload: { v: PROTOCOL_VERSION, members: [ada, bob] } },
      { type: "connect-error", reason: "transport" },
      { type: "reconnecting" },
      { type: "reconnected" },
    ]);
  });

  it("feeds a reducer end to end", () => {
    const { socket, fire } = fakeSocket();
    let state = initialLobbyState;
    bindRoomSocket(socket, (event) => (state = reduceLobby(state, event)), fakeReload().deps);
    fire("welcome", welcome(2, [bob]));
    fire("roster", { v: PROTOCOL_VERSION, members: [bob, ada] });
    expect(state).toEqual({ phase: "live", error: null, you: 2, members: [ada, bob] });
  });
});

/** An in-memory session storage plus a spy reload (ADR 0006 point 4: a stale bundle reloads once). */
function fakeReload(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const reload = vi.fn();
  const deps: VersionReload = {
    reload,
    storage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
      removeItem: (key) => void store.delete(key),
    },
  };
  return { deps, reload, store };
}

// Card #575: on a `version` refusal the page reloads once; a second refusal falls back to `generic`.
describe("bindRoomSocket version skew", () => {
  function wire(initial?: Record<string, string>) {
    const { socket, fire } = fakeSocket();
    const fake = fakeReload(initial);
    let state = initialLobbyState;
    bindRoomSocket(socket, (event) => (state = reduceLobby(state, event)), fake.deps);
    return { fire, ...fake, state: () => state };
  }

  it("C1: a first version refusal reloads once, sets the marker and stays out of the error phase", () => {
    const { fire, reload, store, state } = wire();
    fire("connectError", "version" satisfies ConnectErrorReason);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.has(VERSION_RELOAD_KEY)).toBe(true);
    expect(state().phase).not.toBe("error");
    // socket.io may report the refusal again before the page unloads: still one reload.
    fire("connectError", "version" satisfies ConnectErrorReason);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("C2: with the marker already set, a version refusal is the generic error and does not reload", () => {
    const { fire, reload, state } = wire({ [VERSION_RELOAD_KEY]: "1" });
    fire("connectError", "version" satisfies ConnectErrorReason);
    expect(reload).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ phase: "error", error: "generic" });
  });

  it("C2: a successful welcome clears the marker", () => {
    const { fire, store } = wire({ [VERSION_RELOAD_KEY]: "1" });
    fire("welcome", welcome(1, [ada]));
    expect(store.has(VERSION_RELOAD_KEY)).toBe(false);
  });

  it("C2: without storage (blocked or private mode) it never reloads, so it cannot loop", () => {
    const { socket, fire } = fakeSocket();
    const reload = vi.fn();
    let state = initialLobbyState;
    bindRoomSocket(socket, (event) => (state = reduceLobby(state, event)), {
      reload,
      storage: null,
    });
    fire("connectError", "version" satisfies ConnectErrorReason);
    expect(reload).not.toHaveBeenCalled();
    expect(state).toMatchObject({ phase: "error", error: "generic" });
  });

  it.each([
    ["bad-token", "error", "generic"],
    ["no-room", "error", "not-found"],
    ["closed", "error", "closed"],
    ["transport", "reconnecting", null],
  ] as const)("C3: %s keeps its mapping and never reloads", (reason, phase, error) => {
    const { fire, reload, store, state } = wire();
    fire("connectError", reason);
    expect(reload).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
    expect(state()).toMatchObject({ phase, error });
  });
});
