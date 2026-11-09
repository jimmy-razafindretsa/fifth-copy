import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Redis } from "ioredis";
import type { Rng } from "@fifth-copy/engine";
import { createLimiter } from "@fifth-copy/limiter";
import { PROTOCOL_VERSION, type RaceEvent } from "@fifth-copy/protocol";
import type { Clock, Scheduler, TimerHandle } from "./clock";
import type { RaceServerEnv } from "./env";
import { createInternalHandler } from "./http/internal";
import { createNonceStore } from "./http/nonces";
import { createHttpHandler } from "./http/router";
import { createOutbox, type Outbox } from "./persist/outbox";
import { buildResults, sendResults } from "./persist/results";
import type { WebApi } from "./persist/web-api";
import { createIdle } from "./players/idle";
import { releaseDropped, type LeaveDeps } from "./players/leave";
import { createPresence, type Presence } from "./players/presence";
import { createResumeKeys } from "./players/resume-keys";
import { createBonuses } from "./rooms/bonus-step";
import { createBotDrivers, type BotDrivers } from "./rooms/bot-driver";
import { createDesksState, playerStateOf, type DesksState } from "./rooms/desks-state";
import { durationsFor } from "./rooms/durations";
import { ingest } from "./rooms/ingest";
import { createLifecycle, type Lifecycle, type RaceEnded } from "./rooms/lifecycle";
import { createOwnerLease } from "./rooms/owner";
import { createRoomRegistry, RECONCILE_MS, type RoomRegistry } from "./rooms/registry";
import { createTicker } from "./rooms/tick";
import { audience, deskRoom, lobbyRoom, spectatorRoom } from "./socket/rooms";
import { RACE_LIMITER_PREFIX } from "./socket/rate-limit";
import { attachSocketServer, type RacePort, type RaceIo } from "./socket/server";
import {
  createSpectatorSlots,
  MAX_SPECTATORS_PER_ROOM,
  type SpectatorSlots,
} from "./socket/spectator-slots";

export type RaceServer = {
  httpServer: HttpServer;
  io: RaceIo;
  registry: RoomRegistry;
  lifecycle: Lifecycle;
  /** The live desks of running rooms (#173). */
  desks: DesksState;
  /** Results of ended races still to persist (#189); drained on creation. */
  outbox: Outbox;
  /** Socket presence, line cuts and resumes (#178). */
  presence: Presence;
  /** Spectator admission slots per room (#616). */
  spectators: SpectatorSlots;
  /** The bots' drivers of the running rooms (#366). */
  bots: BotDrivers;
  /**
   * Rehydrates the rooms of the previous process (#204) before it binds, then starts the count
   * reconciliation; resolves with the bound port (pass 0 for an ephemeral one in tests).
   */
  listen(port: number, host?: string): Promise<number>;
  /** This process's random id: the `owner` of the races it runs (#704). */
  instanceId: string;
  /**
   * SIGTERM (#704): marks draining (`/health` 503, new rooms refused with a retryable 503) and keeps
   * every live room ticking; resolves `empty` once this process serves no room, `cap` after `capMs`.
   * The caller then closes. Rooms with no live race and no socket here stop counting (Redis keeps
   * them for the next deployment).
   */
  drain(capMs: number): Promise<"empty" | "cap">;
  /** Marks draining, disconnects every socket, closes HTTP, then quits Redis. */
  close(): Promise<void>;
};

/** Period of the drain's room check (#704). */
export const DRAIN_POLL_MS = 1_000;

const log = (msg: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: "info", msg, ...fields }));

/** Composition root: main.ts wires signals around it, tests boot it on port 0. */
export function createRaceServer({
  env,
  redis,
  clock,
  scheduler,
  webApi,
  onRaceEnded,
  recovery = true,
  rng = Math.random,
  maxSpectatorsPerRoom = MAX_SPECTATORS_PER_ROOM,
}: {
  env: Pick<RaceServerEnv, "RACE_TOKEN_SECRET" | "WEB_ORIGIN" | "RACE_FAST_CLOCK">;
  redis: Redis;
  clock: Clock;
  scheduler: Scheduler;
  webApi: WebApi;
  onRaceEnded?: (ended: RaceEnded) => void;
  /**
   * Room recovery (#204, ADR 0008 "Restart behaviour"): `rehydrate` in `listen` and the reconcile
   * timer. Always on in production; off only for tests that share a Redis db with other test
   * files' live rooms (`testing/harness.ts`).
   */
  recovery?: boolean;
  /**
   * Randomness of the bonus effects (#190: Extra Paperwork's words) and of the bots' keys (#366);
   * tests seed it.
   */
  rng?: Rng;
  /** Spectator sockets one room admits on this process (#616); tests lower it. */
  maxSpectatorsPerRoom?: number;
}): RaceServer {
  // Liveness lease (#704): the next deployment boots while this one drains, on the same Redis.
  const lease = createOwnerLease({ redis, scheduler });
  const registry = createRoomRegistry({ redis, clock, owner: lease });
  const spectators = createSpectatorSlots(maxSpectatorsPerRoom);
  // Assigned below: the lifecycle broadcasts through the socket server it is handed to.
  const sockets: { io?: RaceIo } = {};
  // Socket.IO cannot narrow a generic event name to its payload; the callers type the pair.
  const to = (room: string | string[]) =>
    sockets.io?.to(room) as { emit(e: string, p: unknown): boolean } | undefined;

  // Live race (#173): desks' runtime, 10 Hz tick, keystroke ingestion; started at GO, ended with
  // the race, dropped after `onRaceEnded` (persistence reads the traces, #189) or on room close.
  const desksState = createDesksState({ redis });
  const roomEvent = (lobbyId: string, event: RaceEvent) =>
    void to(audience(lobbyId))?.emit("event", event);
  // Presence (#178): line cut and resume of the desks, resume keys in Redis, grace on the scheduler.
  const durations = durationsFor(env);
  const resumeKeys = createResumeKeys({ redis });
  const presence = createPresence({
    registry,
    desksState,
    resumeKeys,
    clock,
    scheduler,
    durations,
    emit: roomEvent,
  });
  // Idle and abandon (#183): a tick step over the connected typing desks, and the abandon edge.
  const idle = createIdle({ desksState, presence, durations, emit: roomEvent });
  // Spectators hear every desk's events too (#187: a projector shows the overtakes).
  const deskEvent = (lobbyId: string, desk: number, payload: RaceEvent) =>
    void to([deskRoom(lobbyId, desk), spectatorRoom(lobbyId)])?.emit("event", payload);
  // Catch-up bonuses (#190): a tick step dealing cards and playing the bots', and the play edge.
  const bonuses = createBonuses({
    desksState,
    emit: { room: roomEvent, desk: deskEvent },
    rng,
  });
  // Bots (#366): one timer per bot desk from GO, keys through `ingest`; real ms, never fast-clocked.
  const bots = createBotDrivers({ clock, scheduler, rng });
  const ticker = createTicker({
    desksState,
    clock,
    scheduler,
    emit: {
      room: (lobbyId: string, event: string, payload: unknown) =>
        void to(audience(lobbyId))?.emit(event, payload),
      desk: deskEvent,
    },
    onTerminal: (lobbyId) => void lifecycle.onDeskTerminal(lobbyId).catch(() => undefined),
    steps: [idle.step, bonuses.step],
    // Redis loss mid-race (#204): the room is voided in process.
    onLost: (lobbyId, raceId) =>
      void lifecycle
        .voidRoom(lobbyId, raceId)
        .catch((err: unknown) => log("void failed", { lobby: lobbyId, err: String(err) })),
  });
  const race: RacePort = {
    ingest: (lobbyId, desk, batch) => ingest(desksState.get(lobbyId), desk, batch, clock.now()),
    abandon: idle.abandon,
    playBonus: (lobbyId, desk) => bonuses.play(lobbyId, desk, clock.now()),
    overlayOf: bonuses.overlayOf,
    bonusOf: (lobbyId, desk) => bonuses.bonusOf(lobbyId, desk, clock.now()),
    stateOf: (lobbyId, desk) => {
      const state = desksState.states(lobbyId).get(desk);
      return state && desksState.get(lobbyId)?.phase === "running" ? playerStateOf(state) : null;
    },
  };
  // Results (#189, ADR 0008 write path): built from the in-process states and traces before
  // `release` frees them, then queued in Redis and posted; pending entries of a previous process
  // are re-sent now.
  const outbox = createOutbox({ redis, clock, scheduler, send: sendResults(webApi) });
  const persist = (ended: RaceEnded) => {
    if (ended.reason === "void") return;
    const runtime = desksState.get(ended.lobbyId);
    if (runtime?.raceId !== ended.raceId) {
      log("results skipped", { lobby: ended.lobbyId, cause: "no runtime" });
      return;
    }
    outbox
      .enqueue(ended.raceId, buildResults(ended, runtime))
      .catch((err: unknown) =>
        log("results enqueue failed", { lobby: ended.lobbyId, err: String(err) }),
      );
  };
  outbox.drain().catch((err: unknown) => log("outbox drain failed", { err: String(err) }));

  const leaveDeps: LeaveDeps = {
    registry,
    presence,
    onRoomClosed: (lobbyId) => lifecycle.onRoomClosed(lobbyId),
    announce: (lobbyId, members) =>
      void to(audience(lobbyId))?.emit("roster", { v: PROTOCOL_VERSION, members }),
  };

  const raceHooks = {
    deskStates: async (lobbyId: string) => desksState.states(lobbyId),
    onEnding: (lobbyId: string) => {
      // Synchronous, before any await of the ending: abandon and the idle kick stand down (#183).
      const runtime = desksState.get(lobbyId);
      if (runtime) runtime.ending = true;
      bots.stop(lobbyId);
      return presence.settle(lobbyId);
    },
    onGo: (
      lobbyId: string,
      init: Parameters<typeof desksState.open>[1] & { bots: Parameters<BotDrivers["start"]>[1] },
    ) => {
      const runtime = desksState.open(lobbyId, init);
      presence.onGo(lobbyId);
      ticker.start(lobbyId);
      bots.start(runtime, init.bots, init.race.language);
    },
    onEnded: (lobbyId: string) => {
      bots.stop(lobbyId);
      ticker.finish(lobbyId);
      desksState.end(lobbyId);
    },
    liveRace: (lobbyId: string) => {
      const runtime = desksState.get(lobbyId);
      if (runtime?.phase !== "running") return null;
      return {
        raceId: runtime.raceId,
        t0: runtime.t0,
        desks: runtime.desks.map(({ desk }) => desk),
      };
    },
    // "Race again" (#143): race 1's runtime goes before race 2's countdown; presence keeps the
    // seats of the members still connected (GO rebuilds the rest).
    onRestart: (lobbyId: string) => {
      bots.stop(lobbyId);
      ticker.stop(lobbyId);
      desksState.close(lobbyId);
      idle.closeRoom(lobbyId);
    },
    onClosed: (lobbyId: string) => {
      bots.stop(lobbyId);
      ticker.stop(lobbyId);
      desksState.close(lobbyId);
      presence.closeRoom(lobbyId);
      idle.closeRoom(lobbyId);
    },
    onRaceEnded: (ended: RaceEnded) => {
      try {
        try {
          persist(ended);
        } catch (err) {
          log("results build failed", { lobby: ended.lobbyId, err: String(err) });
        }
        onRaceEnded?.(ended);
      } finally {
        desksState.release(ended.lobbyId);
        // Queued behind the ending, which still holds the room (#658). A void keeps its members:
        // they reconnect to read `ended { void }` (#204).
        if (ended.reason !== "void") {
          releaseDropped(leaveDeps, ended.lobbyId).catch((err: unknown) =>
            log("release dropped failed", { lobby: ended.lobbyId, err: String(err) }),
          );
        }
      }
    },
  };

  const lifecycle = createLifecycle({
    registry,
    clock,
    scheduler,
    webApi,
    durations,
    emit: (lobbyId, event, payload) => {
      // Socket.IO cannot narrow a generic event name to its payload; `Emit` types the pair.
      void to(audience(lobbyId))?.emit(event, payload);
    },
    ...raceHooks,
  });
  const secret = env.RACE_TOKEN_SECRET;
  let draining = false;
  // `count()` follows the keys (#204): a room expired or deleted behind our back leaves it.
  let reconcileTimer: TimerHandle | null = null;
  const reconcileEvery = () => {
    reconcileTimer = scheduler.setTimeout(() => {
      reconcileEvery();
      registry.reconcile().then(
        // A race whose process is gone (#704): the sockets that reconnected here hear it is over.
        (voided) => {
          for (const { lobbyId, raceId } of voided) {
            to(audience(lobbyId))?.emit("ended", {
              v: PROTOCOL_VERSION,
              raceId,
              reason: "void",
              ranking: [],
            });
          }
        },
        (err: unknown) => log("reconcile failed", { err: String(err) }),
      );
    }, RECONCILE_MS);
  };

  // Drain (#704): a room this process no longer serves stops counting, so the drain ends after the
  // last live race. Live = a race in countdown/running, or a socket of the room on this process.
  let drainTimer: TimerHandle | null = null;
  const hasSockets = (lobbyId: string) =>
    [lobbyRoom(lobbyId), spectatorRoom(lobbyId)].some(
      (name) => (sockets.io?.of("/").adapter.rooms.get(name)?.size ?? 0) > 0,
    );
  const releaseIdle = async () => {
    for (const lobbyId of registry.ids()) {
      if (hasSockets(lobbyId)) continue;
      const room = await registry.room(lobbyId).catch(() => undefined);
      if (room === undefined) continue;
      if (room && (room.phase === "countdown" || room.phase === "running")) continue;
      registry.release(lobbyId);
    }
  };

  const httpServer = createServer(
    createHttpHandler({
      health: { rooms: () => registry.count(), draining: () => draining },
      internal: createInternalHandler({
        registry,
        secret,
        clock,
        nonces: createNonceStore({ redis }),
        draining: () => draining,
      }),
    }),
  );
  const io = attachSocketServer(httpServer, {
    registry,
    lifecycle,
    secret,
    clock,
    origin: env.WEB_ORIGIN,
    race,
    presence,
    resumeKeys,
    spectators,
    // Per-identity buckets (#207): fails closed, a message Redis cannot count is dropped.
    limiter: createLimiter(redis, { prefix: RACE_LIMITER_PREFIX }),
  });
  sockets.io = io;

  return {
    httpServer,
    io,
    registry,
    lifecycle,
    desks: desksState,
    outbox,
    presence,
    spectators,
    bots,
    instanceId: lease.id,
    listen: async (port, host) => {
      if (recovery) {
        await lease.start();
        const { kept, voided, gone, foreign } = await registry.rehydrate();
        log("rooms rehydrated", {
          kept: kept.length,
          voided: voided.length,
          gone: gone.length,
          foreign: foreign.length,
        });
        reconcileEvery();
      }
      return new Promise((resolve) => {
        httpServer.listen(port, host, () => resolve((httpServer.address() as AddressInfo).port));
      });
    },
    drain: (capMs) => {
      draining = true;
      const deadline = clock.now() + capMs;
      return new Promise((resolve) => {
        const poll = () => {
          drainTimer = null;
          releaseIdle().then(
            () => {
              if (registry.count() === 0) return resolve("empty");
              if (clock.now() >= deadline) return resolve("cap");
              drainTimer = scheduler.setTimeout(poll, DRAIN_POLL_MS);
            },
            () => resolve("cap"),
          );
        };
        poll();
      });
    },
    close: async () => {
      draining = true;
      if (drainTimer) scheduler.clear(drainTimer);
      drainTimer = null;
      if (reconcileTimer) scheduler.clear(reconcileTimer);
      reconcileTimer = null;
      await lease.stop();
      lifecycle.close();
      presence.close();
      bots.close();
      ticker.close();
      outbox.close();
      await new Promise<void>((resolve) => void io.close(() => resolve()));
      await redis.quit().catch(() => undefined);
    },
  };
}
