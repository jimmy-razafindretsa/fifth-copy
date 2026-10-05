import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, roomCodeSchema, type Roster, type Welcome } from "@fifth-copy/protocol";
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
    emit(event: string, ...args: unknown[]) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
  };
}

function makeFakeSocket() {
  const socket = makeEmitter();
  const manager = makeEmitter();
  const disconnect = vi.fn();
  return { ...socket, io: manager, disconnect };
}

function setup(token = "tok.en.value") {
  const fake = makeFakeSocket();
  const io = vi.fn(() => fake) as unknown as IoFactory & ReturnType<typeof vi.fn>;
  const room = connectToRoom("http://localhost:7495", token, { io });
  return { fake, io, room };
}

const member = { desk: 1, name: "Ada", isHost: true };
const welcome: Welcome = {
  v: PROTOCOL_VERSION,
  you: 1,
  room: { code: roomCodeSchema.parse("KGB-4821"), phase: "waiting" },
  members: [member],
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

    fake.emit("welcome", welcome);
    fake.emit("welcome", { ...welcome, you: 0 });
    fake.emit("roster", roster);
    fake.emit("roster", { v: PROTOCOL_VERSION, members: "nope" });

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
      fake.emit("connect_error", new Error(reason));
      expect(cb).toHaveBeenCalledWith(reason);
    },
  );

  it("maps any other connect_error to transport", () => {
    const { fake, room } = setup();
    const cb = vi.fn();
    room.onConnectError(cb);
    fake.emit("connect_error", new Error("xhr poll error"));
    fake.emit("connect_error", undefined);
    expect(cb.mock.calls).toEqual([["transport"], ["transport"]]);
  });

  it("wraps the manager's reconnect_attempt and reconnect events", () => {
    const { fake, room } = setup();
    const onReconnecting = vi.fn();
    const onReconnected = vi.fn();
    room.onReconnecting(onReconnecting);
    room.onReconnected(onReconnected);
    fake.io.emit("reconnect_attempt", 2);
    fake.io.emit("reconnect", 2);
    expect(onReconnecting).toHaveBeenCalledWith(2);
    expect(onReconnected).toHaveBeenCalledWith(2);
  });
});

describe("close (C4)", () => {
  it("removes every listener it registered and disconnects", () => {
    const { fake, room } = setup();
    room.onWelcome(() => {});
    room.onRoster(() => {});
    room.onProtocolError(() => {});
    room.onConnectError(() => {});
    room.onReconnecting(() => {});
    room.onReconnected(() => {});
    expect(fake.listeners.size).toBeGreaterThan(0);
    expect(fake.io.listeners.size).toBeGreaterThan(0);

    room.close();

    expect(fake.listeners.size).toBe(0);
    expect(fake.io.listeners.size).toBe(0);
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
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
