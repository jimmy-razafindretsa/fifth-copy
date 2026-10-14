import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  PROTOCOL_VERSION,
  roomCodeSchema,
  type HostSettingsAck,
  type Roster,
  type SettingsEvent,
  type Welcome,
} from "@fifth-copy/protocol";
import { connectToRoom, type IoFactory } from "./socket";

type Listener = (...args: unknown[]) => void;

function makeEmitter() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    listeners,
    on(event: string, fn: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    off(event: string, fn: Listener) {
      listeners.get(event)?.delete(fn);
      if (listeners.get(event)?.size === 0) listeners.delete(event);
    },
    /** Inbound: the server delivering `event` to the client's listeners. */
    deliver(event: string, ...args: unknown[]) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
  };
}

function makeFakeSocket() {
  const socket = makeEmitter();
  const manager = makeEmitter();
  const disconnect = vi.fn();
  /** Outbound: what the client sends; distinct from the inbound `deliver`. */
  const emit = vi.fn();
  return { ...socket, io: manager, disconnect, emit };
}

function setup(token = "tok.en.value") {
  const fake = makeFakeSocket();
  const io = vi.fn(() => fake) as unknown as IoFactory & ReturnType<typeof vi.fn>;
  const room = connectToRoom("http://localhost:7495", token, { io });
  return { fake, io, room };
}

const member = {
  desk: 1,
  name: "Ada",
  isHost: true,
  isBot: false,
  color: 0,
  marker: "circle",
} as const;
const welcome: Welcome = {
  v: PROTOCOL_VERSION,
  role: "host",
  you: 1,
  room: { code: roomCodeSchema.parse("KGB-4821"), phase: "waiting" },
  members: [member],
  settings: DEFAULT_RACE_SETTINGS,
  race: null,
  state: null,
  overlay: null,
  resumeKey: null,
  serverNow: 1767225600000,
};
const roster: Roster = { v: PROTOCOL_VERSION, members: [member] };

afterEach(() => vi.restoreAllMocks());

describe("connectToRoom (C1)", () => {
  it("creates the socket with the token in the handshake auth only", () => {
    const { io } = setup("secret-token");
    expect(io).toHaveBeenCalledTimes(1);
    expect(io).toHaveBeenCalledWith("http://localhost:7495", {
      auth: { v: PROTOCOL_VERSION, token: "secret-token" },
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
    const [url] = (io as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).not.toContain("secret-token");
  });

  it("uses the version override when given", () => {
    const fake = makeFakeSocket();
    const io = vi.fn(() => fake) as unknown as IoFactory;
    connectToRoom("http://x", "t", { version: 99, io });
    expect(io).toHaveBeenCalledWith(
      "http://x",
      expect.objectContaining({ auth: { v: 99, token: "t" } }),
    );
  });
});

describe("resume key in the handshake (#561 C11)", () => {
  const KEY = "a".repeat(32) + "_B-9";

  it("puts the key in the handshake auth next to v and token, and nowhere else", () => {
    const fake = makeFakeSocket();
    const io = vi.fn(() => fake) as unknown as IoFactory & ReturnType<typeof vi.fn>;
    connectToRoom("http://localhost:7561", "tok", { io, resumeKey: KEY });
    expect(io).toHaveBeenCalledTimes(1);
    const [url, opts] = io.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts).toEqual({
      auth: { v: PROTOCOL_VERSION, token: "tok", resumeKey: KEY },
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
    // not the URL, not a query: only the auth payload carries it
    expect(url).toBe("http://localhost:7561");
    expect(opts).not.toHaveProperty("query");
    const { auth, ...rest } = opts;
    expect(JSON.stringify(rest)).not.toContain(KEY);
    expect(auth).toHaveProperty("resumeKey", KEY);
  });

  it.each([undefined, null, ""])("sends no resumeKey field when the key is %j", (resumeKey) => {
    const fake = makeFakeSocket();
    const io = vi.fn(() => fake) as unknown as IoFactory & ReturnType<typeof vi.fn>;
    connectToRoom("http://x", "t", { io, resumeKey });
    const [, opts] = io.mock.calls[0] as [string, { auth: Record<string, unknown> }];
    expect(opts.auth).toEqual({ v: PROTOCOL_VERSION, token: "t" });
  });
});

describe("per-listener off (#561 C3: bindRaceSocket unbinds through these)", () => {
  it("each on* returns an off that removes its own listener and nothing else", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fake, room } = setup();
    const kept = vi.fn();
    const dropped = vi.fn();
    const offs = [
      room.onWelcome(dropped),
      room.onRoster(dropped),
      room.onSettings(dropped),
      room.onProtocolError(dropped),
      room.onConnectError(dropped),
      room.onReconnecting(dropped),
      room.onReconnected(dropped),
    ];
    room.onWelcome(kept);
    for (const off of offs) {
      expect(typeof off).toBe("function");
      off();
      off(); // idempotent
    }
    fake.deliver("welcome", welcome);
    fake.deliver("welcome", { ...welcome, you: 0 });
    fake.deliver("roster", roster);
    fake.deliver("connect_error", new Error("closed"));
    fake.io.deliver("reconnect_attempt", 1);
    fake.io.deliver("reconnect", 1);
    expect(dropped).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
    expect([...fake.listeners.keys()]).toEqual(["welcome"]);
    expect(fake.io.listeners.size).toBe(0);
    room.close();
    expect(fake.listeners.size).toBe(0);
  });
});

describe("parsed events (C2)", () => {
  it("delivers only payloads that parse; invalid ones go to onProtocolError", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fake, room } = setup();
    const onWelcome = vi.fn();
    const onRoster = vi.fn();
    const onProtocolError = vi.fn();
    room.onWelcome(onWelcome);
    room.onRoster(onRoster);
    room.onProtocolError(onProtocolError);

    fake.deliver("welcome", welcome);
    fake.deliver("welcome", { ...welcome, you: 0 });
    fake.deliver("roster", roster);
    fake.deliver("roster", { v: PROTOCOL_VERSION, members: "nope" });

    expect(onWelcome).toHaveBeenCalledTimes(1);
    expect(onWelcome).toHaveBeenCalledWith(welcome);
    expect(onRoster).toHaveBeenCalledTimes(1);
    expect(onRoster).toHaveBeenCalledWith(roster);
    expect(onProtocolError).toHaveBeenCalledTimes(2);
    expect(onProtocolError.mock.calls[0]![0]).toMatchObject({ event: "welcome" });
    expect(onProtocolError.mock.calls[1]![0]).toMatchObject({ event: "roster" });
    for (const [err] of onProtocolError.mock.calls) {
      expect(Array.isArray(err.issues)).toBe(true);
      expect(err.issues.length).toBeGreaterThan(0);
      expect(Object.keys(err).sort()).toEqual(["event", "issues"]);
    }
  });
});

describe("connection lifecycle (C3)", () => {
  it.each(["version", "bad-token", "no-room", "closed"] as const)(
    "passes the reject reason %s through",
    (reason) => {
      const { fake, room } = setup();
      const cb = vi.fn();
      room.onConnectError(cb);
      fake.deliver("connect_error", new Error(reason));
      expect(cb).toHaveBeenCalledWith(reason);
    },
  );

  it("maps any other connect_error to transport", () => {
    const { fake, room } = setup();
    const cb = vi.fn();
    room.onConnectError(cb);
    fake.deliver("connect_error", new Error("xhr poll error"));
    fake.deliver("connect_error", undefined);
    expect(cb.mock.calls).toEqual([["transport"], ["transport"]]);
  });

  it("wraps the manager's reconnect_attempt and reconnect events", () => {
    const { fake, room } = setup();
    const onReconnecting = vi.fn();
    const onReconnected = vi.fn();
    room.onReconnecting(onReconnecting);
    room.onReconnected(onReconnected);
    fake.io.deliver("reconnect_attempt", 2);
    fake.io.deliver("reconnect", 2);
    expect(onReconnecting).toHaveBeenCalledWith(2);
    expect(onReconnected).toHaveBeenCalledWith(2);
  });
});

describe("close (C4)", () => {
  it("removes every listener it registered and disconnects", () => {
    const { fake, room } = setup();
    room.onWelcome(() => {});
    room.onRoster(() => {});
    room.onSettings(() => {});
    room.onProtocolError(() => {});
    room.onConnectError(() => {});
    room.onReconnecting(() => {});
    room.onReconnected(() => {});
    expect(fake.listeners.size).toBeGreaterThan(0);
    expect(fake.io.listeners.size).toBeGreaterThan(0);

    expect(fake.listeners.has("settings")).toBe(true);

    room.close();

    expect(fake.listeners.size).toBe(0);
    expect(fake.io.listeners.size).toBe(0);
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("settings (#101 C4)", () => {
  const settingsEvent: SettingsEvent = {
    v: PROTOCOL_VERSION,
    settings: { ...DEFAULT_RACE_SETTINGS, timerS: 60 },
  };
  const okAck: HostSettingsAck = { ok: true, settings: settingsEvent.settings };

  afterEach(() => vi.useRealTimers());

  /** The ack callback the client passed with its last `host:settings` emit. */
  function lastAck(fake: ReturnType<typeof makeFakeSocket>) {
    const call = fake.emit.mock.calls.at(-1)!;
    return call[2] as (a: unknown) => void;
  }

  it("onSettings delivers a parsed payload and routes an invalid one to onProtocolError", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fake, room } = setup();
    const onSettings = vi.fn();
    const onProtocolError = vi.fn();
    room.onSettings(onSettings);
    room.onProtocolError(onProtocolError);
    fake.deliver("settings", settingsEvent);
    fake.deliver("settings", { v: PROTOCOL_VERSION, settings: { timerS: 60 } });
    expect(onSettings.mock.calls).toEqual([[settingsEvent]]);
    expect(onProtocolError).toHaveBeenCalledTimes(1);
    expect(onProtocolError.mock.calls[0]![0]).toMatchObject({ event: "settings" });
  });

  it("sendHostSettings emits host:settings with the protocol version and resolves with the ack", async () => {
    const { fake, room } = setup();
    const pending = room.sendHostSettings({ timerS: 60 });
    expect(fake.emit).toHaveBeenCalledWith(
      "host:settings",
      { v: PROTOCOL_VERSION, patch: { timerS: 60 } },
      expect.any(Function),
    );
    lastAck(fake)(okAck);
    await expect(pending).resolves.toEqual(okAck);
  });

  it("passes a refusal through", async () => {
    const { fake, room } = setup();
    const pending = room.sendHostSettings({ timerS: 60 });
    lastAck(fake)({ ok: false, error: "not-host" });
    await expect(pending).resolves.toEqual({ ok: false, error: "not-host" });
  });

  it("resolves timeout after 5 s without an ack, never rejects, ignores a late ack", async () => {
    vi.useFakeTimers();
    const { fake, room } = setup();
    let settled: unknown;
    const pending = room.sendHostSettings({ timerS: 60 }).then(
      (r) => (settled = r),
      (e: unknown) => (settled = { rejected: e }),
    );
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toEqual({ ok: false, error: "timeout" });
    lastAck(fake)(okAck);
    await vi.runAllTimersAsync();
    expect(settled).toEqual({ ok: false, error: "timeout" });
  });

  it("an invalid ack resolves timeout and reports a protocol error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fake, room } = setup();
    const onProtocolError = vi.fn();
    room.onProtocolError(onProtocolError);
    const pending = room.sendHostSettings({ timerS: 60 });
    lastAck(fake)({ ok: false, error: "teapot" });
    await expect(pending).resolves.toEqual({ ok: false, error: "timeout" });
    expect(onProtocolError).toHaveBeenCalledTimes(1);
    expect(onProtocolError.mock.calls[0]![0]).toMatchObject({ event: "host:settings" });
  });
});

describe("boundaries (C5)", () => {
  const source = readFileSync(path.join(__dirname, "socket.ts"), "utf8");

  it("imports only socket.io-client, @fifth-copy/protocol and zod", () => {
    const specifiers = [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const s of specifiers)
      expect(["socket.io-client", "@fifth-copy/protocol", "zod"]).toContain(s);
  });

  it("has no use client directive and no window/document access", () => {
    expect(source).not.toMatch(/use client/);
    expect(source).not.toMatch(/\b(window|document)\b/);
  });
});
