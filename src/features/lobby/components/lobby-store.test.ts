import { describe, expect, it, vi, type Mock } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  deskIdentity,
  PROTOCOL_VERSION,
  type Member,
  type RaceSettings,
} from "@fifth-copy/protocol";
import type { ConnectErrorReason, RoomEvents, RoomSocket } from "@/features/race";
import {
  bindRoomSocket,
  autoStartSecondsAt,
  initialLobbyState,
  lobbyErrorCopy,
  NO_AUTO_START,
  reduceLobby,
  VERSION_RELOAD_KEY,
  type LobbyEvent,
  type VersionReload,
} from "./lobby-store";
import { joinRoom, LATE_JOIN_RETRY_MS, type JoinRoomDeps } from "./late-join";

// Contract of card 107, C5: the lobby store reduces `welcome` and `roster` into a desk-sorted list.
// Fixtures of the v4 shape (#557): members carry isBot and their desk identity.
const member = (desk: number, name: string, isHost: boolean): Member => ({
  desk,
  name,
  isHost,
  isBot: false,
  ...deskIdentity(desk),
  avatar: null,
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
  bonus: null,
  resumeKey: null,
  serverNow: 1767225600000,
  autoStartAt: null,
  pending: null,
});

function run(...events: LobbyEvent[]) {
  return events.reduce(reduceLobby, initialLobbyState);
}

/** A fake `RoomSocket`: collects the callbacks the store binds, so a test can fire them. */
function fakeSocket() {
  const cbs: Partial<Record<string, (arg: never) => void>> = {};
  // each on* returns its off (#561); the lobby unbinds them all before it parks the socket (#214)
  const offs: Record<string, Mock<() => void>> = {};
  // every listener of an event, as on a real socket (the late-join hold binds beside the store, #732)
  const listeners: Record<string, ((arg: never) => void)[]> = {};
  const bind = (name: string) => (cb: unknown) => {
    cbs[name] = cb as never;
    (listeners[name] ??= []).push(cb as never);
    const off = vi.fn<() => void>(() => {
      listeners[name] = (listeners[name] ?? []).filter((fn) => fn !== cb);
    });
    offs[name] = off;
    return off;
  };
  const socket: RoomSocket = {
    onWelcome: bind("welcome"),
    onRoster: bind("roster"),
    onSettings: bind("settings"),
    sendHostSettings: vi.fn(),
    onLoading: bind("loading"),
    onReadiness: bind("readiness"),
    sendReady: vi.fn(),
    onCountdown: bind("countdown"),
    onAutoStart: bind("autoStart"),
    sendHostStart: vi.fn(),
    sendHostKick: vi.fn(),
    // #559: the seat view's typing (the lobby binds none of them)
    sendKeys: vi.fn(),
    onSnapshot: bind("snapshot"),
    onEvent: bind("event"),
    onEnded: bind("ended"),
    onRejected: bind("rejected"),
    // #643: the seat view's clock sync (the lobby binds none of them)
    sendPing: vi.fn(),
    sendBonusPlay: vi.fn(),
    sendAbandon: vi.fn(),
    onPong: bind("pong"),
    onProtocolError: bind("protocolError"),
    onConnectError: bind("connectError"),
    onReconnecting: bind("reconnecting"),
    onServerDisconnect: bind("serverDisconnect"),
    onTransportDisconnect: bind("transportDisconnect"),
    onReconnected: bind("reconnected"),
    reconnect: vi.fn(),
    close: vi.fn(),
  };
  const fire = (name: string, arg: unknown) => {
    for (const fn of [...(listeners[name] ?? [])]) fn(arg as never);
  };
  return { socket, cbs, fire, offs };
}

describe("reduceLobby", () => {
  it("starts loading with no members", () => {
    expect(initialLobbyState).toEqual({
      phase: "loading",
      error: null,
      you: null,
      watching: false,
      members: [],
      raceId: null,
      settings: null,
      autoStart: NO_AUTO_START,
      newHost: null,
      newHosts: 0,
    });
  });

  it("welcome sets the viewer's desk and sorts members by desk", () => {
    const state = run({ type: "welcome", payload: welcome(2, [cyd, bob, ada]) });
    expect(state).toEqual({
      phase: "live",
      error: null,
      you: 2,
      watching: false,
      members: [ada, bob, cyd],
      raceId: null,
      settings: DEFAULT_RACE_SETTINGS,
      autoStart: NO_AUTO_START,
      newHost: null,
      newHosts: 0,
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

  it("keeps each member's avatar from welcome and roster (#730 C1)", () => {
    const pictured = { ...bob, avatar: { userId: "usr_bob", v: 2 } };
    const welcomed = run({ type: "welcome", payload: welcome(1, [pictured, ada]) });
    expect(welcomed.members.map((m) => m.avatar)).toEqual([null, { userId: "usr_bob", v: 2 }]);
    const rostered = run(
      { type: "welcome", payload: welcome(1, [ada]) },
      {
        type: "roster",
        payload: {
          v: PROTOCOL_VERSION,
          members: [ada, { ...pictured, avatar: { userId: "usr_bob", v: 3 } }],
        },
      },
    );
    expect(rostered.members[1]?.avatar).toEqual({ userId: "usr_bob", v: 3 });
  });

  it.each([
    ["closed", "closed"],
    ["no-room", "not-found"],
    ["bad-token", "generic"],
    ["version", "generic"],
    // a seated viewer refused later (#732 C4): the generic error, never the late joiner's hold
    ["in-progress", "generic"],
    // every desk taken (#678): its own sentence
    ["room-full", "room-full"],
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
    bindRoomSocket(socket, dispatch, { versionReload: fakeReload().deps, now: () => 7 });
    expect(Object.keys(cbs).sort()).toEqual(
      [
        "autoStart",
        "connectError",
        "countdown",
        "event",
        "loading",
        "reconnected",
        "reconnecting",
        "roster",
        "serverDisconnect",
        "settings",
        "welcome",
      ].sort(),
    );

    const w = welcome(1, [ada]);
    fire("welcome", w);
    fire("roster", { v: PROTOCOL_VERSION, members: [ada, bob] });
    fire("connectError", "transport" satisfies ConnectErrorReason);
    fire("reconnecting", 1);
    fire("reconnected", 1);
    const changed = { v: PROTOCOL_VERSION, settings: { ...DEFAULT_RACE_SETTINGS, bonuses: false } };
    fire("settings", changed);
    expect(dispatch.mock.calls.map(([e]) => e)).toEqual([
      { type: "welcome", payload: w, receivedAt: 7 },
      { type: "roster", payload: { v: PROTOCOL_VERSION, members: [ada, bob] } },
      { type: "connect-error", reason: "transport" },
      { type: "reconnecting" },
      { type: "reconnected" },
      { type: "settings", payload: changed },
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
      watching: false,
      members: [ada, bob],
      raceId: null,
      settings: DEFAULT_RACE_SETTINGS,
      autoStart: { ...NO_AUTO_START, offset: expect.any(Number) },
      newHost: null,
      newHosts: 0,
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
// #661 C1: the server closing a seated viewer's socket (`io server disconnect`) is final: socket.io never
// reconnects it, so the page leaves its live or reconnecting state for the terminal error instead of
// waiting forever. Before the first seat the late-join hold owns that close (#732), so the store waits.
describe("server disconnect (#661 C1)", () => {
  const seated = () =>
    reduceLobby(initialLobbyState, { type: "welcome", payload: welcome(1, [ada]) });

  it("a seated viewer: terminal error with the server's reason, the roll kept", () => {
    const next = reduceLobby(seated(), { type: "server-disconnect" });
    expect(next).toMatchObject({ phase: "error", error: "server-disconnect", you: 1 });
    expect(next.members).toEqual([ada]);
  });

  it("while reconnecting, too; and nothing later revives it", () => {
    const cut = reduceLobby(seated(), { type: "reconnecting" });
    const gone = reduceLobby(cut, { type: "server-disconnect" });
    expect(gone).toMatchObject({ phase: "error", error: "server-disconnect" });
    expect(reduceLobby(gone, { type: "reconnected" })).toBe(gone);
    expect(reduceLobby(gone, { type: "welcome", payload: welcome(1, [ada]) })).toBe(gone);
  });

  it("never seated (loading, spectating): left to the late-join hold", () => {
    expect(reduceLobby(initialLobbyState, { type: "server-disconnect" })).toBe(initialLobbyState);
    const held = reduceLobby(initialLobbyState, { type: "connect-error", reason: "in-progress" });
    expect(reduceLobby(held, { type: "server-disconnect" })).toBe(held);
  });

  it("reads the generic error line", () => {
    expect(lobbyErrorCopy("server-disconnect")).toBe("generic");
    expect(lobbyErrorCopy(null)).toBe("generic");
    expect(lobbyErrorCopy("room-full")).toBe("room-full");
  });

  it("bindRoomSocket dispatches it; a transport drop is not it", () => {
    const { socket, fire } = fakeSocket();
    const dispatch = vi.fn();
    bindRoomSocket(socket, dispatch, { versionReload: fakeReload().deps });
    fire("transportDisconnect", undefined);
    expect(dispatch).not.toHaveBeenCalled();
    fire("serverDisconnect", undefined);
    expect(dispatch.mock.calls).toEqual([[{ type: "server-disconnect" }]]);
  });
});

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
      watching: false,
      members: [ada, bob],
      raceId: RACE_ID,
      settings: DEFAULT_RACE_SETTINGS,
      autoStart: NO_AUTO_START,
      newHost: null,
      newHosts: 0,
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
      [
        "autoStart",
        "connectError",
        "countdown",
        "event",
        "loading",
        "reconnected",
        "reconnecting",
        "roster",
        "serverDisconnect",
        "settings",
        "welcome",
      ].sort(),
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
  const started = (phase: "loading" | "countdown" | "running"): RoomEvents["welcome"] => ({
    ...welcome(2, [ada, bob]),
    room: { code: "KGB-4821" as never, phase },
    race,
  });

  // #926 C5: a welcome while the room loads moves the page too.
  it.each(["loading", "countdown", "running"] as const)(
    "C1: a %s welcome with the race gives the state a countdown would",
    (phase) => {
      expect(run({ type: "welcome", payload: started(phase) })).toEqual({
        phase: "starting",
        error: null,
        you: 2,
        watching: false,
        members: [ada, bob],
        raceId: RACE_ID,
        settings: DEFAULT_RACE_SETTINGS,
        autoStart: NO_AUTO_START,
        newHost: null,
        newHosts: 0,
      });
    },
  );

  it("#926 C5: loading moves the page to the seat view as a countdown does", () => {
    const loading: RoomEvents["loading"] = { v: PROTOCOL_VERSION, race, pending: [1, 2] };
    expect(
      run(
        { type: "welcome", payload: welcome(2, [ada, bob]) },
        { type: "loading", payload: loading },
      ),
    ).toMatchObject({ phase: "starting", raceId: RACE_ID });
  });

  it("#926: binds loading and dispatches it", () => {
    const { socket, fire } = fakeSocket();
    const dispatch = vi.fn();
    bindRoomSocket(socket, dispatch, { versionReload: fakeReload().deps });
    const loading: RoomEvents["loading"] = { v: PROTOCOL_VERSION, race, pending: [] };
    fire("loading", loading);
    expect(dispatch).toHaveBeenCalledWith({ type: "loading", payload: loading });
  });

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
      watching: false,
      members: [ada, bob],
      raceId: null,
      settings: DEFAULT_RACE_SETTINGS,
      autoStart: NO_AUTO_START,
      newHost: null,
      newHosts: 0,
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

// Contract of #498 C1: the room's settings come from `welcome.settings` and every `settings` broadcast
// (ADR 0006: the client's only source); a roster never touches them.
describe("settings (#498 C1)", () => {
  const block = { ...DEFAULT_RACE_SETTINGS, errorMode: "block" as const, timerS: 300 };
  const fr = { ...DEFAULT_RACE_SETTINGS, language: "fr" as const, accentEveryWord: true };
  const settingsEvent = (settings: RaceSettings): RoomEvents["settings"] => ({
    v: PROTOCOL_VERSION,
    settings,
  });

  it("is null until the welcome, then the welcome's settings", () => {
    expect(initialLobbyState.settings).toBeNull();
    const state = run({ type: "welcome", payload: { ...welcome(1, [ada]), settings: fr } });
    expect(state.settings).toEqual(fr);
  });

  it("every settings event replaces them whole", () => {
    const state = run(
      { type: "welcome", payload: welcome(1, [ada]) },
      { type: "settings", payload: settingsEvent(block) },
    );
    expect(state.settings).toEqual(block);
    expect(reduceLobby(state, { type: "settings", payload: settingsEvent(fr) }).settings).toEqual(
      fr,
    );
  });

  it("a roster leaves them untouched", () => {
    const before = run(
      { type: "welcome", payload: welcome(1, [ada]) },
      { type: "settings", payload: settingsEvent(block) },
    );
    const after = reduceLobby(before, {
      type: "roster",
      payload: { v: PROTOCOL_VERSION, members: [ada, bob] },
    });
    expect(after.settings).toBe(before.settings);
  });

  it("a later welcome (a reconnect) brings the room's current settings", () => {
    const state = run(
      { type: "welcome", payload: welcome(1, [ada]) },
      { type: "reconnecting" },
      { type: "welcome", payload: { ...welcome(1, [ada]), settings: block } },
    );
    expect(state.settings).toEqual(block);
  });

  it("an error stays terminal: a settings event never revives it", () => {
    const state = run(
      { type: "token-error", error: "closed" },
      { type: "settings", payload: settingsEvent(block) },
    );
    expect(state).toMatchObject({ phase: "error", settings: null });
  });

  it("bindRoomSocket binds onSettings and feeds the reducer", () => {
    const { socket, fire, offs } = fakeSocket();
    let state = initialLobbyState;
    const unbind = bindRoomSocket(socket, (event) => (state = reduceLobby(state, event)), {
      versionReload: fakeReload().deps,
    });
    fire("welcome", welcome(1, [ada]));
    fire("settings", settingsEvent(block));
    expect(state.settings).toEqual(block);
    unbind();
    expect(offs.settings).toHaveBeenCalledTimes(1);
  });
});

// Contract of #732 C1 and C4: an `in-progress` refusal before the viewer was ever seated enters the
// `spectating` hold; a viewer who had a desk (a line-cut member, a second tab) keeps today's handling.
describe("spectating (#732 C1 C4)", () => {
  const refused = { type: "connect-error", reason: "in-progress" } as const;

  it("C1: in-progress from loading is phase spectating, not an error", () => {
    expect(run(refused)).toEqual({ ...initialLobbyState, phase: "spectating" });
  });

  it("C1: a first connect that went through reconnecting, never seated, also holds", () => {
    expect(run({ type: "connect-error", reason: "transport" }, refused).phase).toBe("spectating");
  });

  it("C1: spectating keeps its phase on in-progress, transport and reconnect events", () => {
    for (const event of [
      refused,
      { type: "connect-error", reason: "transport" },
      { type: "reconnecting" },
      { type: "reconnected" },
    ] as const) {
      expect(run(refused, event).phase).toBe("spectating");
    }
  });

  it("a player join refused room-full (every desk taken) ends the hold in its own error (#678)", () => {
    expect(run(refused, { type: "connect-error", reason: "room-full" })).toMatchObject({
      phase: "error",
      error: "room-full",
    });
  });

  it("C1: a refusal that is not about the race still ends the hold in its error", () => {
    expect(run(refused, { type: "connect-error", reason: "no-room" })).toMatchObject({
      phase: "error",
      error: "not-found",
    });
  });

  it("C2: the player welcome of an ended room seats the viewer: live, no notice", () => {
    const ended = welcome(3, [ada, bob, member(3, "Cyd", false)]);
    const state = run(refused, {
      type: "welcome",
      payload: { ...ended, room: { ...ended.room, phase: "ended" } },
    });
    expect(state).toMatchObject({ phase: "live", you: 3 });
    expect(state.members).toHaveLength(3);
  });

  it.each(["live", "reconnecting", "starting"] as const)(
    "C4: a viewer seated before (%s) refused in-progress keeps the generic error",
    (phase) => {
      const seated = run({ type: "welcome", payload: welcome(2, [ada, bob]) });
      const state = reduceLobby(
        { ...seated, phase, raceId: phase === "starting" ? "r" : null },
        refused,
      );
      expect(state).toMatchObject({ phase: "error", error: "generic" });
    },
  );
});

// Contract of #732 C2: the late joiner's hold (`joinRoom`), on fake sockets and an injected timer.
describe("joinRoom: the late joiner's hold (#732 C2)", () => {
  function harness() {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const events: LobbyEvent[] = [];
    const timers: { fn: () => void; ms: number }[] = [];
    const mint = vi.fn(async ({ spectator }: { spectator: boolean }) => ({
      ok: true as const,
      token: spectator ? "spectator-token" : "player-token",
      url: "ws://race.test",
    }));
    const connect = vi.fn(async () => {
      const fake = fakeSocket();
      sockets.push(fake);
      return fake.socket;
    });
    const attached: RoomSocket[] = [];
    const detach = vi.fn();
    const deps: JoinRoomDeps = {
      mint,
      connect,
      // the page's binding: the store sees the player socket's events
      attach: (socket) => {
        attached.push(socket);
        const off = bindRoomSocket(socket, (e) => events.push(e), {
          versionReload: { reload: vi.fn(), storage: null },
        });
        return () => {
          off();
          detach();
        };
      },
      dispatch: (e) => events.push(e),
      setTimer: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimer: vi.fn(),
    };
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const state = () => events.reduce(reduceLobby, initialLobbyState);
    return { sockets, events, timers, mint, connect, attached, detach, deps, flush, state };
  }

  const endedWelcome = (you: number, members: Member[]): RoomEvents["welcome"] => {
    const w = welcome(you, members);
    return { ...w, room: { ...w.room, phase: "ended" } };
  };
  const spectatorWelcome = (phase: "running" | "ended"): RoomEvents["welcome"] => ({
    ...welcome(1, [ada, bob]),
    role: "spectator",
    you: null,
    room: { code: "KGB-4821" as never, phase },
  });

  it("is LATE_JOIN_RETRY_MS = 10 s (under the 10/min mint budget)", () => {
    expect(LATE_JOIN_RETRY_MS).toBe(10_000);
  });

  it("a seat at once: one player mint, one socket, attached, no hold", async () => {
    const h = harness();
    joinRoom(h.deps);
    await h.flush();
    expect(h.mint.mock.calls).toEqual([[{ spectator: false }]]);
    h.sockets[0]!.fire("welcome", welcome(2, [ada, bob]));
    expect(h.state()).toMatchObject({ phase: "live", you: 2 });
    expect(h.attached).toEqual([h.sockets[0]!.socket]);
    expect(h.sockets[0]!.socket.close).not.toHaveBeenCalled();
  });

  it("in-progress -> spectator welcome -> ended -> player welcome: seated, every refused socket closed", async () => {
    const h = harness();
    joinRoom(h.deps);
    await h.flush();
    const [player1] = h.sockets;
    player1!.fire("connectError", "in-progress");
    expect(h.state().phase).toBe("spectating");
    // the refused socket never reconnects by itself: closed and unbound
    expect(player1!.socket.close).toHaveBeenCalled();
    expect(h.detach).toHaveBeenCalledTimes(1);
    await h.flush();
    expect(h.mint.mock.calls[1]).toEqual([{ spectator: true }]);
    expect(h.connect.mock.calls[1]).toEqual(["ws://race.test", "spectator-token"]);
    const watcher = h.sockets[1]!;
    // the spectator socket never reaches the store: its `you: null` welcome would empty the roll
    expect(h.attached).not.toContain(watcher.socket);
    watcher.fire("welcome", spectatorWelcome("running"));
    expect(h.state().phase).toBe("spectating");
    watcher.fire("ended", {
      v: PROTOCOL_VERSION,
      raceId: "r",
      reason: "all-finished",
      ranking: [],
    });
    expect(watcher.socket.close).toHaveBeenCalled();
    await h.flush();
    expect(h.mint.mock.calls[2]).toEqual([{ spectator: false }]);
    const player2 = h.sockets[2]!;
    expect(h.attached.at(-1)).toBe(player2.socket);
    player2.fire("welcome", endedWelcome(3, [ada, bob, member(3, "Cyd", false)]));
    expect(h.state()).toMatchObject({ phase: "live", you: 3 });
    expect(h.state().members).toHaveLength(3);
    expect(player2.socket.close).not.toHaveBeenCalled();
    expect(h.timers).toEqual([]);
  });

  it("a spectator welcome of a room already ended seats at once", async () => {
    const h = harness();
    joinRoom(h.deps);
    await h.flush();
    h.sockets[0]!.fire("connectError", "in-progress");
    await h.flush();
    h.sockets[1]!.fire("welcome", spectatorWelcome("ended"));
    expect(h.sockets[1]!.socket.close).toHaveBeenCalled();
    await h.flush();
    expect(h.mint).toHaveBeenLastCalledWith({ spectator: false });
    expect(h.sockets).toHaveLength(3);
  });

  it("room-full keeps the notice and retries the player join every LATE_JOIN_RETRY_MS", async () => {
    const h = harness();
    h.deps.retryMs = 7;
    joinRoom(h.deps);
    await h.flush();
    h.sockets[0]!.fire("connectError", "in-progress");
    await h.flush();
    h.sockets[1]!.fire("connectError", "room-full");
    expect(h.state().phase).toBe("spectating");
    expect(h.sockets[1]!.socket.close).toHaveBeenCalled();
    expect(h.timers.map((t) => t.ms)).toEqual([7]);
    expect(h.mint).toHaveBeenCalledTimes(2);
    // the retry: a player join; still racing -> refused -> the next retry, no spectator mint again
    h.timers[0]!.fn();
    await h.flush();
    expect(h.mint).toHaveBeenLastCalledWith({ spectator: false });
    h.sockets[2]!.fire("connectError", "in-progress");
    expect(h.sockets[2]!.socket.close).toHaveBeenCalled();
    expect(h.state().phase).toBe("spectating");
    expect(h.timers.map((t) => t.ms)).toEqual([7, 7]);
    await h.flush();
    expect(h.mint).toHaveBeenCalledTimes(3);
    // the race ended meanwhile: the next retry seats
    h.timers[1]!.fn();
    await h.flush();
    h.sockets[3]!.fire("welcome", endedWelcome(3, [ada, bob, member(3, "Cyd", false)]));
    expect(h.state()).toMatchObject({ phase: "live", you: 3 });
  });

  it("a server disconnect before the first welcome holds as in-progress", async () => {
    const h = harness();
    joinRoom(h.deps);
    await h.flush();
    const [player1] = h.sockets;
    player1!.fire("serverDisconnect", undefined);
    expect(h.state().phase).toBe("spectating");
    expect(player1!.socket.close).toHaveBeenCalled();
    expect(h.detach).toHaveBeenCalledTimes(1);
    await h.flush();
    expect(h.mint).toHaveBeenLastCalledWith({ spectator: true });
    h.sockets[1]!.fire("ended", {
      v: PROTOCOL_VERSION,
      raceId: "r",
      reason: "all-finished",
      ranking: [],
    });
    await h.flush();
    h.sockets[2]!.fire("welcome", endedWelcome(3, [ada, bob, member(3, "Cyd", false)]));
    expect(h.state()).toMatchObject({ phase: "live", you: 3 });
  });

  it("a rejected before the server disconnect (the socket cap) ends the join: no hold, no retry", async () => {
    const h = harness();
    joinRoom(h.deps);
    await h.flush();
    h.sockets[0]!.fire("rejected", { v: PROTOCOL_VERSION, reason: "rate-limit" });
    h.sockets[0]!.fire("serverDisconnect", undefined);
    await h.flush();
    expect(h.state()).toMatchObject({ phase: "error", error: "generic" });
    expect(h.mint).toHaveBeenCalledTimes(1);
    expect(h.sockets).toHaveLength(1);
    expect(h.timers).toEqual([]);
  });

  it("a server disconnect after the seat is not the hold's: the store's terminal error (#661 C1)", async () => {
    const h = harness();
    joinRoom(h.deps);
    await h.flush();
    h.sockets[0]!.fire("welcome", welcome(2, [ada, bob]));
    h.sockets[0]!.fire("serverDisconnect", undefined);
    await h.flush();
    expect(h.state()).toMatchObject({ phase: "error", error: "server-disconnect" });
    expect(h.mint).toHaveBeenCalledTimes(1);
    expect(h.timers).toEqual([]);
  });

  it("a full room at the seat ends the hold: no retry, the room-full error (#678)", async () => {
    const h = harness();
    joinRoom(h.deps);
    await h.flush();
    h.sockets[0]!.fire("connectError", "room-full");
    await h.flush();
    expect(h.state()).toMatchObject({ phase: "error", error: "room-full" });
    expect(h.mint).toHaveBeenCalledTimes(1);
    expect(h.timers).toEqual([]);
  });

  it("a server disconnect of the spectator socket retries the seat after LATE_JOIN_RETRY_MS", async () => {
    const h = harness();
    joinRoom(h.deps);
    await h.flush();
    h.sockets[0]!.fire("connectError", "in-progress");
    await h.flush();
    h.sockets[1]!.fire("serverDisconnect", undefined);
    expect(h.sockets[1]!.socket.close).toHaveBeenCalled();
    expect(h.timers.map((t) => t.ms)).toEqual([LATE_JOIN_RETRY_MS]);
    expect(h.state().phase).toBe("spectating");
  });

  it("a throttled mint during the hold waits LATE_JOIN_RETRY_MS instead of failing", async () => {
    const h = harness();
    joinRoom(h.deps);
    await h.flush();
    h.mint.mockResolvedValueOnce({ ok: false, error: "rate-limited" } as never);
    h.sockets[0]!.fire("connectError", "in-progress");
    await h.flush();
    expect(h.state().phase).toBe("spectating");
    expect(h.timers.map((t) => t.ms)).toEqual([LATE_JOIN_RETRY_MS]);
  });

  it("the first mint's refusal is the page's error, as before (throttled is generic)", async () => {
    const h = harness();
    h.mint.mockResolvedValueOnce({ ok: false, error: "rate-limited" } as never);
    joinRoom(h.deps);
    await h.flush();
    expect(h.state()).toMatchObject({ phase: "error", error: "generic" });
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("a transport error of the spectator socket waits for its own reconnect", async () => {
    const h = harness();
    joinRoom(h.deps);
    await h.flush();
    h.sockets[0]!.fire("connectError", "in-progress");
    await h.flush();
    h.sockets[1]!.fire("connectError", "transport");
    expect(h.sockets[1]!.socket.close).not.toHaveBeenCalled();
    expect(h.state().phase).toBe("spectating");
  });

  it("an in-progress refusal after the seat is the store's, never a new hold", async () => {
    const h = harness();
    joinRoom(h.deps);
    await h.flush();
    h.sockets[0]!.fire("welcome", welcome(2, [ada, bob]));
    h.sockets[0]!.fire("connectError", "in-progress");
    await h.flush();
    expect(h.state()).toMatchObject({ phase: "error", error: "generic" });
    expect(h.mint).toHaveBeenCalledTimes(1);
    expect(h.sockets[0]!.socket.close).not.toHaveBeenCalled();
  });

  it("cancel closes the spectator socket and clears the pending retry; a late mint opens nothing", async () => {
    const h = harness();
    const cancel = joinRoom(h.deps);
    await h.flush();
    h.sockets[0]!.fire("connectError", "in-progress");
    await h.flush();
    h.sockets[1]!.fire("connectError", "room-full");
    cancel();
    expect(h.deps.clearTimer).toHaveBeenCalledWith(1);
    const idle = harness();
    const stop = joinRoom(idle.deps);
    stop();
    await idle.flush();
    expect(idle.connect).not.toHaveBeenCalled();
  });

  it("cancel while spectating closes the spectator socket", async () => {
    const h = harness();
    const cancel = joinRoom(h.deps);
    await h.flush();
    h.sockets[0]!.fire("connectError", "in-progress");
    await h.flush();
    cancel();
    expect(h.sockets[1]!.socket.close).toHaveBeenCalled();
    h.sockets[1]!.fire("ended", {
      v: PROTOCOL_VERSION,
      raceId: "r",
      reason: "all-finished",
      ranking: [],
    });
    await h.flush();
    expect(h.sockets).toHaveLength(2);
  });
});

describe("public room auto start (#814 C6)", () => {
  const SERVER_NOW = 1767225600000;
  const at = (startsAt: number | null) => ({ v: PROTOCOL_VERSION, startsAt }) as const;
  // the device runs 2 s behind the server: server time = device time + 2 000
  const DEVICE = SERVER_NOW - 2_000;
  const live = (autoStartAt: number | null = null) =>
    run({
      type: "welcome",
      payload: { ...welcome(2, [ada, bob]), autoStartAt },
      receivedAt: DEVICE,
    });

  it("welcome.autoStartAt sets the instant and the clock offset from serverNow", () => {
    const state = live(SERVER_NOW + 45_000);
    expect(state.autoStart).toEqual({
      at: SERVER_NOW + 45_000,
      offset: 2_000,
      notice: { kind: "armed", seconds: 45 },
    });
    expect(autoStartSecondsAt(state.autoStart, DEVICE)).toBe(45);
    expect(autoStartSecondsAt(state.autoStart, DEVICE + 1)).toBe(45);
    expect(autoStartSecondsAt(state.autoStart, DEVICE + 1_000)).toBe(44);
    expect(autoStartSecondsAt(state.autoStart, DEVICE + 44_001)).toBe(1);
    expect(autoStartSecondsAt(state.autoStart, DEVICE + 45_000)).toBe(0);
    // never below 0
    expect(autoStartSecondsAt(state.autoStart, DEVICE + 90_000)).toBe(0);
  });

  it("no instant: null seconds, no notice", () => {
    const state = live();
    expect(state.autoStart).toEqual({ at: null, offset: 2_000, notice: null });
    expect(autoStartSecondsAt(state.autoStart, DEVICE)).toBeNull();
  });

  it("auto-start arms (notice frozen at its arrival), a repeat changes nothing, null drops it", () => {
    const armed = reduceLobby(live(), {
      type: "auto-start",
      payload: at(SERVER_NOW + 45_000),
      receivedAt: DEVICE + 3_000,
    });
    expect(armed.autoStart).toEqual({
      at: SERVER_NOW + 45_000,
      offset: 2_000,
      notice: { kind: "armed", seconds: 42 },
    });
    expect(reduceLobby(armed, { type: "auto-start", payload: at(SERVER_NOW + 45_000) })).toBe(
      armed,
    );
    const dropped = reduceLobby(armed, { type: "auto-start", payload: at(null) });
    expect(dropped.autoStart).toEqual({ at: null, offset: 2_000, notice: { kind: "dropped" } });
    expect(dropped.phase).toBe("live");
  });

  it("a reconnect's welcome keeps the instant (no second announcement) or reads its drop", () => {
    const armed = live(SERVER_NOW + 45_000);
    const again = reduceLobby(armed, {
      type: "welcome",
      payload: {
        ...welcome(2, [ada, bob]),
        autoStartAt: SERVER_NOW + 45_000,
        serverNow: SERVER_NOW + 5_000,
      },
      receivedAt: DEVICE + 5_000,
    });
    expect(again.autoStart).toEqual(armed.autoStart);
    const gone = reduceLobby(armed, { type: "welcome", payload: welcome(2, [ada, bob]) });
    expect(gone.autoStart.at).toBeNull();
    expect(gone.autoStart.notice).toEqual({ kind: "dropped" });
  });

  it("countdown still moves the page to the race (#214)", () => {
    const state = reduceLobby(live(SERVER_NOW + 45_000), {
      type: "countdown",
      payload: {
        v: PROTOCOL_VERSION,
        race: {
          raceId: "3f0c8a52-6a3e-4c1b-9d7e-2b5f1e8a4c90",
          text: "Le reçu",
          language: "fr",
          wordCount: 2,
          t0: SERVER_NOW + 48_000,
          timerS: null,
        },
      },
    });
    expect(state).toMatchObject({
      phase: "starting",
      raceId: "3f0c8a52-6a3e-4c1b-9d7e-2b5f1e8a4c90",
    });
  });

  it("bindRoomSocket stamps auto-start with the device clock", () => {
    const { socket, fire } = fakeSocket();
    const dispatch = vi.fn();
    bindRoomSocket(socket, dispatch, { versionReload: fakeReload().deps, now: () => 42 });
    fire("autoStart", at(SERVER_NOW));
    expect(dispatch).toHaveBeenCalledWith({
      type: "auto-start",
      payload: at(SERVER_NOW),
      receivedAt: 42,
    });
  });
});

// #133 C5: the host removed this viewer. `kicked` for its own desk, or a `connect_error removed` (a
// reload, a second tab), puts the store in the terminal `removed` state: no reconnect, no late-join
// hold; nothing after it revives the page.
describe("removed (#133 C5)", () => {
  const kicked = (desk: number): LobbyEvent => ({
    type: "event",
    payload: { v: PROTOCOL_VERSION, kind: "kicked", desk },
  });

  it("kicked for the viewer's desk: phase removed, error null", () => {
    const state = run({ type: "welcome", payload: welcome(2, [ada, bob]) }, kicked(2));
    expect(state.phase).toBe("removed");
    expect(state.error).toBeNull();
  });

  it("kicked for another desk changes nothing (the roster drops the row)", () => {
    const before = run({ type: "welcome", payload: welcome(1, [ada, bob]) });
    expect(reduceLobby(before, kicked(2))).toBe(before);
  });

  it("another event kind changes nothing", () => {
    const before = run({ type: "welcome", payload: welcome(2, [ada, bob]) });
    const other: LobbyEvent = {
      type: "event",
      payload: { v: PROTOCOL_VERSION, kind: "new-leader", desk: 2 },
    };
    expect(reduceLobby(before, other)).toBe(before);
  });

  it.each([
    ["loading", initialLobbyState],
    ["live", run({ type: "welcome", payload: welcome(2, [ada, bob]) })],
    [
      "reconnecting",
      run({ type: "welcome", payload: welcome(2, [ada, bob]) }, { type: "reconnecting" }),
    ],
    ["spectating", run({ type: "connect-error", reason: "in-progress" })],
  ] as const)("connect_error removed while %s: removed", (_, from) => {
    expect(reduceLobby(from, { type: "connect-error", reason: "removed" }).phase).toBe("removed");
  });

  it("terminal: the server's close, a reconnect, a welcome or a roster never revive it", () => {
    const removed = run({ type: "welcome", payload: welcome(2, [ada, bob]) }, kicked(2));
    for (const event of [
      { type: "server-disconnect" },
      { type: "reconnecting" },
      { type: "reconnected" },
      { type: "connect-error", reason: "transport" },
      { type: "welcome", payload: welcome(2, [ada, bob]) },
      { type: "roster", payload: { v: PROTOCOL_VERSION, members: [ada] } },
    ] as LobbyEvent[]) {
      expect(reduceLobby(removed, event)).toBe(removed);
    }
  });

  it("bindRoomSocket turns the socket's events into lobby events", () => {
    const { socket, fire } = fakeSocket();
    const dispatch = vi.fn();
    bindRoomSocket(socket, dispatch, { versionReload: { reload: vi.fn(), storage: null } });
    const payload = { v: PROTOCOL_VERSION, kind: "kicked", desk: 2 };
    fire("event", payload);
    expect(dispatch).toHaveBeenCalledWith({ type: "event", payload });
  });

  it("the late-join hold does not hold a removed viewer: no spectator mint, no retry", async () => {
    const { socket, fire } = fakeSocket();
    const mint = vi.fn(async () => ({ ok: true as const, url: "ws://race", token: "t" }));
    const setTimer = vi.fn();
    const events: LobbyEvent[] = [];
    joinRoom({
      mint,
      connect: async () => socket,
      attach: (s) =>
        bindRoomSocket(s, (e) => events.push(e), {
          versionReload: { reload: vi.fn(), storage: null },
        }),
      dispatch: (e) => events.push(e),
      setTimer,
    });
    await vi.waitFor(() => expect(mint).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    fire("connectError", "removed");
    await new Promise((r) => setTimeout(r, 0));
    expect(events.reduce(reduceLobby, initialLobbyState).phase).toBe("removed");
    expect(mint).toHaveBeenCalledTimes(1);
    expect(setTimer).not.toHaveBeenCalled();
  });
});

// #137 C4: the host left for good. The roster (sent first) moves the HOST tag and the controls; the
// `new-host` event puts the NEW HOST stamp over the roll until its hold ends or the next one replaces it.
describe("new host (#137 C4)", () => {
  const newHost = (desk: number): LobbyEvent => ({
    type: "event",
    payload: { v: PROTOCOL_VERSION, kind: "new-host", desk },
  });
  const promoted: RoomEvents["roster"] = {
    v: PROTOCOL_VERSION,
    members: [{ ...bob, isHost: true }, cyd],
  };

  it("new-host stamps the promoted desk with seq 1; the roster makes the viewer host", () => {
    const state = run(
      { type: "welcome", payload: welcome(2, [ada, bob, cyd]) },
      { type: "roster", payload: promoted },
      newHost(2),
    );
    expect(state.newHost).toEqual({ desk: 2, seq: 1 });
    expect(state.members.find((m) => m.desk === 2)?.isHost).toBe(true);
    expect(state.members.some((m) => m.name === "Ada")).toBe(false);
    expect(state.phase).toBe("live");
  });

  it("the hold's end clears its own stamp only; a later new-host replaces it with the next seq", () => {
    const first = run({ type: "welcome", payload: welcome(5, [ada, bob, cyd]) }, newHost(2));
    const second = reduceLobby(first, newHost(5));
    expect(second.newHost).toEqual({ desk: 5, seq: 2 });
    // the first stamp's timer firing late leaves the second
    expect(reduceLobby(second, { type: "new-host-done", seq: 1 })).toBe(second);
    const gone = reduceLobby(second, { type: "new-host-done", seq: 2 });
    expect(gone.newHost).toBeNull();
    expect(reduceLobby(gone, newHost(2)).newHost).toEqual({ desk: 2, seq: 3 });
  });

  it("a reconnect's welcome keeps the stamp and its count", () => {
    const stamped = run({ type: "welcome", payload: welcome(5, [ada, bob, cyd]) }, newHost(2));
    const again = reduceLobby(stamped, { type: "welcome", payload: welcome(5, [bob, cyd]) });
    expect(again.newHost).toEqual({ desk: 2, seq: 1 });
    expect(again.newHosts).toBe(1);
  });

  it("bindRoomSocket forwards new-host", () => {
    const { socket, fire } = fakeSocket();
    const dispatch = vi.fn();
    bindRoomSocket(socket, dispatch, { versionReload: { reload: vi.fn(), storage: null } });
    const payload = { v: PROTOCOL_VERSION, kind: "new-host", desk: 2 };
    fire("event", payload);
    fire("event", { v: PROTOCOL_VERSION, kind: "new-leader", desk: 2 });
    expect(dispatch.mock.calls).toEqual([[{ type: "event", payload }]]);
  });
});

describe("the host watches (#876 C5)", () => {
  const watching = (): RoomEvents["welcome"] => ({
    ...welcome(1, [bob]),
    you: null,
    settings: { ...DEFAULT_RACE_SETTINGS, hostWatches: true },
  });

  it("a seat welcome with no desk: live, watching, the roll without the host", () => {
    const state = run({ type: "welcome", payload: watching() });
    expect(state).toMatchObject({ phase: "live", you: null, watching: true, members: [bob] });
  });

  it("the switch back's welcome seats the viewer: watching off, its desk", () => {
    const state = run(
      { type: "welcome", payload: watching() },
      { type: "welcome", payload: welcome(1, [ada, bob]) },
    );
    expect(state).toMatchObject({ phase: "live", you: 1, watching: false });
  });

  it("a spectator's no-desk welcome is not watching; a watching host's reconnect is live again", () => {
    const spectator = { ...watching(), role: "spectator" as const };
    expect(run({ type: "welcome", payload: spectator }).watching).toBe(false);
    const back = run(
      { type: "welcome", payload: watching() },
      { type: "reconnecting" },
      { type: "reconnected" },
    );
    expect(back.phase).toBe("live");
  });
});
