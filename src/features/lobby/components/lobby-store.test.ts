import { describe, expect, it, vi, type Mock } from "vitest";
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
  // each on* returns its off (#561); the lobby unbinds them all before it parks the socket (#214)
  const offs: Record<string, Mock<() => void>> = {};
  const bind = (name: string) => (cb: unknown) => {
    cbs[name] = cb as never;
    const off = vi.fn<() => void>();
    offs[name] = off;
    return off;
  };
  const socket: RoomSocket = {
    onWelcome: bind("welcome"),
    onRoster: bind("roster"),
    onSettings: bind("settings"),
    sendHostSettings: vi.fn(),
    onCountdown: bind("countdown"),
    sendHostStart: vi.fn(),
    // #559: the seat view's typing (the lobby binds none of them)
    sendKeys: vi.fn(),
    onSnapshot: bind("snapshot"),
    onEvent: bind("event"),
    onRejected: bind("rejected"),
    onProtocolError: bind("protocolError"),
    onConnectError: bind("connectError"),
    onReconnecting: bind("reconnecting"),
    onReconnected: bind("reconnected"),
    close: vi.fn(),
  };
  const fire = (name: string, arg: unknown) => cbs[name]?.(arg as never);
  return { socket, cbs, fire, offs };
}

describe("reduceLobby", () => {
  it("starts loading with no members", () => {
    expect(initialLobbyState).toEqual({
      phase: "loading",
      error: null,
      you: null,
      members: [],
      raceId: null,
    });
  });

  it("welcome sets the viewer's desk and sorts members by desk", () => {
    const state = run({ type: "welcome", payload: welcome(2, [cyd, bob, ada]) });
    expect(state).toEqual({
      phase: "live",
      error: null,
      you: 2,
      members: [ada, bob, cyd],
      raceId: null,
    });
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
    bindRoomSocket(socket, dispatch, { versionReload: fakeReload().deps });
    expect(Object.keys(cbs).sort()).toEqual(
      ["connectError", "countdown", "reconnected", "reconnecting", "roster", "welcome"].sort(),
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
    bindRoomSocket(socket, (event) => (state = reduceLobby(state, event)), {
      versionReload: fakeReload().deps,
    });
    fire("welcome", welcome(2, [bob]));
    fire("roster", { v: PROTOCOL_VERSION, members: [bob, ada] });
    expect(state).toEqual({
      phase: "live",
      error: null,
      you: 2,
      members: [ada, bob],
      raceId: null,
    });
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
    bindRoomSocket(socket, (event) => (state = reduceLobby(state, event)), {
      versionReload: fake.deps,
    });
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
      versionReload: { reload, storage: null },
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

// Contract of #214 C2 (the waiting-room side): the store handles `countdown` (one case: phase
// `starting`, keeping `raceId`, from which `LobbyLive` navigates to `/race/<raceId>`), and
// `bindRoomSocket(socket, dispatch, { lobbyId })` stores every `welcome.resumeKey` with the race
// feature's `storeResumeKey` (#561), injected from the lazily loaded race module (card 536: no static
// value import of `@/features/race` in the lobby's first load).
describe("countdown and the resume key (#214 C2)", () => {
  const LOBBY = "cmuvut8r2000106r7wf01vr30";
  const KEY = "k".repeat(40);
  const RACE_ID = "3b241101-e2bb-4255-8caf-4136c566a962";
  const countdown: RoomEvents["countdown"] = {
    v: PROTOCOL_VERSION,
    race: {
      raceId: RACE_ID,
      text: "Type fast. Type first.",
      language: "en",
      wordCount: 4,
      t0: 1_767_225_603_000,
      timerS: DEFAULT_RACE_SETTINGS.timerS,
    },
  };

  it("countdown: phase starting with the race id; the roll is kept", () => {
    const state = run(
      { type: "welcome", payload: welcome(1, [ada, bob]) },
      { type: "countdown", payload: countdown },
    );
    expect(state).toEqual({
      phase: "starting",
      error: null,
      you: 1,
      members: [ada, bob],
      raceId: RACE_ID,
    });
    // a roster while the page moves keeps it starting
    const later = reduceLobby(state, {
      type: "roster",
      payload: { v: PROTOCOL_VERSION, members: [ada] },
    });
    expect(later).toMatchObject({ phase: "starting", raceId: RACE_ID, members: [ada] });
  });

  it("an error stays terminal: a countdown never revives it", () => {
    const error = run({ type: "token-error", error: "closed" });
    expect(reduceLobby(error, { type: "countdown", payload: countdown })).toBe(error);
  });

  it("binds countdown and dispatches it", () => {
    const { socket, fire } = fakeSocket();
    const dispatch = vi.fn();
    bindRoomSocket(socket, dispatch, { versionReload: fakeReload().deps });
    fire("countdown", countdown);
    expect(dispatch).toHaveBeenCalledWith({ type: "countdown", payload: countdown });
  });

  it("stores welcome.resumeKey under the lobby on every welcome", () => {
    const { socket, fire } = fakeSocket();
    const storeResumeKey = vi.fn();
    bindRoomSocket(socket, vi.fn(), {
      lobbyId: LOBBY,
      storeResumeKey,
      versionReload: fakeReload().deps,
    });
    fire("welcome", { ...welcome(1, [ada]), resumeKey: KEY });
    fire("welcome", { ...welcome(1, [ada]), resumeKey: "j".repeat(40) });
    expect(storeResumeKey.mock.calls).toEqual([
      [LOBBY, KEY],
      [LOBBY, "j".repeat(40)],
    ]);
    // a welcome without a key stores nothing
    fire("welcome", welcome(1, [ada]));
    expect(storeResumeKey).toHaveBeenCalledTimes(2);
  });

  it("without a lobby id nothing is stored", () => {
    const { socket, fire } = fakeSocket();
    const storeResumeKey = vi.fn();
    bindRoomSocket(socket, vi.fn(), { storeResumeKey, versionReload: fakeReload().deps });
    fire("welcome", { ...welcome(1, [ada]), resumeKey: KEY });
    expect(storeResumeKey).not.toHaveBeenCalled();
  });

  it("returns an unbind that offs every listener it bound", () => {
    const { socket, offs } = fakeSocket();
    const unbind = bindRoomSocket(socket, vi.fn(), { versionReload: fakeReload().deps });
    unbind();
    unbind();
    expect(Object.keys(offs).sort()).toEqual(
      ["connectError", "countdown", "reconnected", "reconnecting", "roster", "welcome"].sort(),
    );
    for (const off of Object.values(offs)) expect(off).toHaveBeenCalledTimes(1);
  });
});

// Contract of #659: a welcome after START carries the room's phase and race; the store treats it like
// the countdown it may have missed, so a reload or a reconnect during the countdown still redirects.
describe("welcome during the countdown (#659)", () => {
  const RACE_ID = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
  const race = {
    raceId: RACE_ID,
    text: "Type fast. Type first.",
    language: "en" as const,
    wordCount: 4,
    t0: 1_767_225_603_000,
    timerS: DEFAULT_RACE_SETTINGS.timerS,
  };
  const started = (phase: "countdown" | "running"): RoomEvents["welcome"] => ({
    ...welcome(2, [ada, bob]),
    room: { code: "KGB-4821" as never, phase },
    race,
  });

  it.each(["countdown", "running"] as const)(
    "C1: a %s welcome with the race gives the state a countdown would",
    (phase) => {
      expect(run({ type: "welcome", payload: started(phase) })).toEqual({
        phase: "starting",
        error: null,
        you: 2,
        members: [ada, bob],
        raceId: RACE_ID,
      });
    },
  );

  it("C1: a reconnect that missed the countdown broadcast still reaches the race", () => {
    const state = run(
      { type: "welcome", payload: welcome(2, [ada, bob]) },
      { type: "reconnecting" },
      { type: "reconnected" },
      { type: "welcome", payload: started("countdown") },
    );
    expect(state).toMatchObject({ phase: "starting", raceId: RACE_ID });
  });

  it("C2: a waiting welcome keeps today's behaviour", () => {
    expect(run({ type: "welcome", payload: welcome(2, [bob, ada]) })).toEqual({
      phase: "live",
      error: null,
      you: 2,
      members: [ada, bob],
      raceId: null,
    });
  });

  it("C3: a welcome while starting does not go back to live when the room is counting down", () => {
    const countdown: RoomEvents["countdown"] = { v: PROTOCOL_VERSION, race };
    const state = run(
      { type: "welcome", payload: welcome(1, [ada, bob]) },
      { type: "countdown", payload: countdown },
      { type: "welcome", payload: { ...started("countdown"), you: 1, role: "host" } },
    );
    expect(state).toMatchObject({ phase: "starting", raceId: RACE_ID, you: 1 });
  });

  it("an ended welcome that still names the last race stays live (no redirect)", () => {
    const ended = {
      ...started("running"),
      room: { code: "KGB-4821" as never, phase: "ended" as const },
    };
    expect(run({ type: "welcome", payload: ended })).toMatchObject({ phase: "live", raceId: null });
  });

  it("a countdown welcome without the race keeps a starting page starting", () => {
    const countdown: RoomEvents["countdown"] = { v: PROTOCOL_VERSION, race };
    const bare = { ...started("countdown"), race: null };
    const state = run(
      { type: "welcome", payload: welcome(2, [ada, bob]) },
      { type: "countdown", payload: countdown },
      { type: "welcome", payload: bare },
    );
    expect(state).toMatchObject({ phase: "starting", raceId: RACE_ID });
  });
});
