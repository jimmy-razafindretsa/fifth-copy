import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Redis } from "ioredis";
import type { RaceEvent } from "@fifth-copy/protocol";
import type { Clock, Scheduler, TimerHandle } from "./clock";
import type { RaceServerEnv } from "./env";
import { createInternalHandler } from "./http/internal";
import { createHttpHandler } from "./http/router";
import { createOutbox, type Outbox } from "./persist/outbox";
import { buildResults, sendResults } from "./persist/results";
import type { WebApi } from "./persist/web-api";
import { createIdle } from "./players/idle";
import { createPresence, type Presence } from "./players/presence";
import { createResumeKeys } from "./players/resume-keys";
import { createDesksState, playerStateOf, type DesksState } from "./rooms/desks-state";
import { durationsFor } from "./rooms/durations";
import { ingest } from "./rooms/ingest";
import { createLifecycle, type Lifecycle, type RaceEnded } from "./rooms/lifecycle";
import { createRoomRegistry, RECONCILE_MS, type RoomRegistry } from "./rooms/registry";
import { createTicker } from "./rooms/tick";
import {
  attachSocketServer,
  deskRoom,
  lobbyRoom,
  type RacePort,
  type RaceIo,
} from "./socket/server";

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
  /**
   * Rehydrates the rooms of the previous process (#204) before it binds, then starts the count
   * reconciliation; resolves with the bound port (pass 0 for an ephemeral one in tests).
   */
  listen(port: number, host?: string): Promise<number>;
  /** Marks draining, disconnects every socket, closes HTTP, then quits Redis. */
  close(): Promise<void>;
};

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
}): RaceServer {
  const registry = createRoomRegistry({ redis, clock });
  // Assigned below: the lifecycle broadcasts through the socket server it is handed to.
  const sockets: { io?: RaceIo } = {};
  // Socket.IO cannot narrow a generic event name to its payload; the callers type the pair.
  const to = (room: string) =>
    sockets.io?.to(room) as { emit(e: string, p: unknown): boolean } | undefined;

  // Live race (#173): desks' runtime, 10 Hz tick, keystroke ingestion; started at GO, ended with
  // the race, dropped after `onRaceEnded` (persistence reads the traces, #189) or on room close.
  const desksState = createDesksState({ redis });
  const roomEvent = (lobbyId: string, event: RaceEvent) =>
    void to(lobbyRoom(lobbyId))?.emit("event", event);
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
  const ticker = createTicker({
    desksState,
    clock,
    scheduler,
    emit: {
      room: (lobbyId: string, event: string, payload: unknown) =>
        void to(lobbyRoom(lobbyId))?.emit(event, payload),
      desk: (lobbyId, desk, payload) => void to(deskRoom(lobbyId, desk))?.emit("event", payload),
    },
    onTerminal: (lobbyId) => void lifecycle.onDeskTerminal(lobbyId).catch(() => undefined),
    steps: [idle.step],
    // Redis loss mid-race (#204): the room is voided in process.
    onLost: (lobbyId, raceId) =>
      void lifecycle
        .voidRoom(lobbyId, raceId)
        .catch((err: unknown) => log("void failed", { lobby: lobbyId, err: String(err) })),
  });
  const race: RacePort = {
    ingest: (lobbyId, desk, batch) => ingest(desksState.get(lobbyId), desk, batch, clock.now()),
    abandon: idle.abandon,
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

  const raceHooks = {
    deskStates: async (lobbyId: string) => desksState.states(lobbyId),
    onEnding: (lobbyId: string) => {
      // Synchronous, before any await of the ending: abandon and the idle kick stand down (#183).
      const runtime = desksState.get(lobbyId);
      if (runtime) runtime.ending = true;
      return presence.settle(lobbyId);
    },
    onGo: (lobbyId: string, init: Parameters<typeof desksState.open>[1]) => {
      desksState.open(lobbyId, init);
      presence.onGo(lobbyId);
      ticker.start(lobbyId);
    },
    onEnded: (lobbyId: string) => {
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
    onClosed: (lobbyId: string) => {
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
      const room = sockets.io?.to(lobbyRoom(lobbyId)) as
        { emit(e: string, p: unknown): boolean } | undefined;
      room?.emit(event, payload);
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
      registry.reconcile().catch((err: unknown) => log("reconcile failed", { err: String(err) }));
    }, RECONCILE_MS);
  };

  const httpServer = createServer(
    createHttpHandler({
      health: { rooms: () => registry.count(), draining: () => draining },
      internal: createInternalHandler({ registry, secret, clock }),
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
    listen: async (port, host) => {
      if (recovery) {
        const { kept, voided, gone } = await registry.rehydrate();
        log("rooms rehydrated", { kept: kept.length, voided: voided.length, gone: gone.length });
        reconcileEvery();
      }
      return new Promise((resolve) => {
        httpServer.listen(port, host, () => resolve((httpServer.address() as AddressInfo).port));
      });
    },
    close: async () => {
      draining = true;
      if (reconcileTimer) scheduler.clear(reconcileTimer);
      reconcileTimer = null;
      lifecycle.close();
      presence.close();
      ticker.close();
      outbox.close();
      await new Promise<void>((resolve) => void io.close(() => resolve()));
      await redis.quit().catch(() => undefined);
    },
  };
}
