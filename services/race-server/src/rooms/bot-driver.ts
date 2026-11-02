import {
  botProfile,
  charsOf,
  nextBotKeystroke,
  type BotLanguage,
  type BotLevel,
  type BotProfile,
  type Rng,
} from "@fifth-copy/engine";
import type { Clock, Scheduler, TimerHandle } from "../clock";
import { textOf, type RoomRuntime } from "./desks-state";
import { ingest as ingestKeys } from "./ingest";

/** A bot desk of the race and its level, from the members hash at GO (#366). */
export type BotSeat = { desk: number; level: BotLevel };

export type BotDrivers = {
  /**
   * GO (#366): one driver per bot desk of `runtime`, replacing the room's previous ones. A desk
   * outside the race or not `typing` gets none.
   */
  start(runtime: RoomRuntime, bots: readonly BotSeat[], language?: BotLanguage): void;
  /** Cancels every bot timer of the room (race ending, ended, restarted, voided or closed). */
  stop(lobbyId: string): void;
  /** Cancels every bot timer (shutdown). */
  close(): void;
  /** The bot desks of the room with a key pending (tests, diagnostics). */
  active(lobbyId: string): number[];
};

type Driver = {
  readonly desk: number;
  readonly profile: BotProfile;
  handle: TimerHandle | null;
  /** `charsOf` the desk's effective text, rebuilt when an overlay changes it (C6). */
  text: string;
  chars: readonly string[];
};

/**
 * Bots as server race participants (ADR 0006 point 3, 0007; ARCHITECTURE 7.5): the engine's
 * `nextBotKeystroke` decides each key and its delay; this only schedules it on the injected clock
 * and feeds it through `ingest`, the path human keys take (clamps, budget, trace cap), with `t` the
 * server elapsed since GO. One pending handle per bot, never a queue of keys. Delays are real ms,
 * never scaled by the fast clock (a scaled bot would type 10x its level and trip `wpm-cap`).
 * Independent of Socket.IO and of Redis: the load test (spec 9) and the Quick race fill reuse it.
 */
export function createBotDrivers({
  clock,
  scheduler,
  rng,
  next = nextBotKeystroke,
  profileOf = botProfile,
  ingest = ingestKeys,
}: {
  clock: Clock;
  scheduler: Scheduler;
  rng: Rng;
  next?: typeof nextBotKeystroke;
  profileOf?: (level: BotLevel) => BotProfile;
  ingest?: typeof ingestKeys;
}): BotDrivers {
  const rooms = new Map<string, Map<number, Driver>>();

  function drop(lobbyId: string, driver: Driver) {
    if (driver.handle) scheduler.clear(driver.handle);
    driver.handle = null;
    const room = rooms.get(lobbyId);
    room?.delete(driver.desk);
    if (room?.size === 0) rooms.delete(lobbyId);
  }

  const live = (runtime: RoomRuntime) => runtime.phase === "running" && !runtime.ending;

  /** Asks the engine for the desk's next key and arms its timer, or drops the driver. */
  function arm(runtime: RoomRuntime, driver: Driver, language: BotLanguage | undefined) {
    const state = runtime.states.get(driver.desk);
    if (!live(runtime) || state?.status !== "typing") return drop(runtime.lobbyId, driver);
    const text = textOf(runtime, driver.desk);
    if (text !== driver.text) {
      driver.text = text;
      driver.chars = charsOf(text);
    }
    const action = next(
      driver.profile,
      {
        chars: driver.chars,
        state,
        settings: runtime.engine,
        elapsedMs: clock.now() - runtime.t0,
        language,
      },
      rng,
    );
    if (action === null) return drop(runtime.lobbyId, driver);
    driver.handle = scheduler.setTimeout(() => {
      driver.handle = null;
      if (rooms.get(runtime.lobbyId)?.get(driver.desk) !== driver) return;
      if (!live(runtime) || runtime.states.get(driver.desk)?.status !== "typing") {
        return drop(runtime.lobbyId, driver);
      }
      const now = clock.now();
      const { terminal } = ingest(runtime, driver.desk, [{ t: now - runtime.t0, key: action.key }], now);
      if (terminal) return drop(runtime.lobbyId, driver);
      arm(runtime, driver, language);
    }, action.delayMs);
  }

  function stop(lobbyId: string) {
    for (const driver of [...(rooms.get(lobbyId)?.values() ?? [])]) drop(lobbyId, driver);
    rooms.delete(lobbyId);
  }

  return {
    start(runtime, bots, language) {
      stop(runtime.lobbyId);
      const room = new Map<number, Driver>();
      rooms.set(runtime.lobbyId, room);
      for (const { desk, level } of bots) {
        if (!runtime.states.has(desk)) continue;
        const driver: Driver = { desk, profile: profileOf(level), handle: null, text: "", chars: [] };
        room.set(desk, driver);
        arm(runtime, driver, language);
      }
      if (room.size === 0) rooms.delete(runtime.lobbyId);
    },
    stop,
    close() {
      for (const lobbyId of [...rooms.keys()]) stop(lobbyId);
    },
    active: (lobbyId) =>
      [...(rooms.get(lobbyId)?.values() ?? [])]
        .filter((d) => d.handle !== null)
        .map((d) => d.desk)
        .sort((a, b) => a - b),
  };
}
