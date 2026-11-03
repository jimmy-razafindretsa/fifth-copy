import { vi, type Mock } from "vitest";
import type { HostSettingsResult, HostStartResult, Off, RoomSocket } from "../socket";

// Test support only (#682): imported by `*.test.ts` files, never by app code (depcruise
// `feature-testing-only-from-tests`). The one typed `RoomSocket` fake of the race client: the object
// literal `satisfies RoomSocket` with no `unknown` cast, so a member added to `RoomSocket` (a new
// `bindRaceSocket` listener, #654) is a type error here instead of a runtime TypeError in a test.

/** The `on*` members of `RoomSocket`. */
type OnKey = Extract<keyof RoomSocket, `on${string}`>;
/** The callback an `on*` member takes. */
type Callback<K extends OnKey> = Parameters<RoomSocket[K]>[0];
/** `onWelcome` -> `welcome`, `onServerDisconnect` -> `serverDisconnect`. */
export type RoomSocketEvent = OnKey extends `on${infer E}` ? Uncapitalize<E> : never;
type EventOf<K extends OnKey> = K extends `on${infer E}` ? Uncapitalize<E> : never;

/** One recorded `on*` call: the event it listens to and the `Off` it returned. */
export type BoundListener = { event: RoomSocketEvent; off: Mock<Off> };

/**
 * A `RoomSocket` whose every `on*` is a `vi.fn` returning a recorded `Off` (in `bound`/`offs`, in call
 * order); `deliver(event, payload)` fires every listener of `event` not yet offed, as a real socket
 * would. Payloads are not parsed: a test passes the fields the code under test reads.
 */
export function fakeRoomSocket() {
  const listeners = new Map<RoomSocketEvent, ((payload: unknown) => void)[]>();
  const bound: BoundListener[] = [];
  const offs: Mock<Off>[] = [];

  function on<K extends OnKey>(key: K) {
    const event = (key.charAt(2).toLowerCase() + key.slice(3)) as EventOf<K>;
    return vi.fn((cb: Callback<K>): Off => {
      const fn = cb as (payload: unknown) => void;
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
      const off = vi.fn<Off>(() => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((l) => l !== fn),
        );
      });
      bound.push({ event, off });
      offs.push(off);
      return off;
    });
  }

  const socket = {
    onWelcome: on("onWelcome"),
    onRoster: on("onRoster"),
    onSettings: on("onSettings"),
    sendHostSettings: vi.fn(async (): Promise<HostSettingsResult> => ({
      ok: false,
      error: "timeout",
    })),
    onCountdown: on("onCountdown"),
    sendHostStart: vi.fn(async (): Promise<HostStartResult> => ({ ok: false, error: "timeout" })),
    sendKeys: vi.fn<RoomSocket["sendKeys"]>(),
    onSnapshot: on("onSnapshot"),
    onEvent: on("onEvent"),
    onEnded: on("onEnded"),
    onRejected: on("onRejected"),
    sendBonusPlay: vi.fn<RoomSocket["sendBonusPlay"]>(),
    sendAbandon: vi.fn<RoomSocket["sendAbandon"]>(),
    sendPing: vi.fn<RoomSocket["sendPing"]>(),
    onPong: on("onPong"),
    onProtocolError: on("onProtocolError"),
    onConnectError: on("onConnectError"),
    onServerDisconnect: on("onServerDisconnect"),
    onReconnecting: on("onReconnecting"),
    onReconnected: on("onReconnected"),
    close: vi.fn<RoomSocket["close"]>(),
  } satisfies RoomSocket;

  return {
    ...socket,
    /** Every `on*` call so far, in order, with the `Off` it returned. */
    bound,
    /** The `Off` of every `on*` call so far, in order (a live array). */
    offs,
    /** Fires every live listener of `event` with `payload`. */
    deliver(event: RoomSocketEvent, payload?: unknown) {
      for (const fn of [...(listeners.get(event) ?? [])]) fn(payload);
    },
  };
}

export type FakeRoomSocket = ReturnType<typeof fakeRoomSocket>;
