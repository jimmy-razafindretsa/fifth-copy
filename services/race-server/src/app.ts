import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Redis } from "ioredis";
import type { Clock, Scheduler } from "./clock";
import type { RaceServerEnv } from "./env";
import { createInternalHandler } from "./http/internal";
import { createHttpHandler } from "./http/router";
import { createOutbox, type Outbox } from "./persist/outbox";
import { buildResults, sendResults } from "./persist/results";
import type { WebApi } from "./persist/web-api";
import { createPresence, type Presence } from "./players/presence";
import { createResumeKeys } from "./players/resume-keys";
import { createDesksState, playerStateOf, type DesksState } from "./rooms/desks-state";
import { durationsFor } from "./rooms/durations";
import { ingest } from "./rooms/ingest";
import { createLifecycle, type Lifecycle, type RaceEnded } from "./rooms/lifecycle";
import { createRoomRegistry, type RoomRegistry } from "./rooms/registry";
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
  /** Resolves with the bound port (pass 0 for an ephemeral one in tests). */
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
}: {
  env: Pick<RaceServerEnv, "RACE_TOKEN_SECRET" | "WEB_ORIGIN" | "RACE_FAST_CLOCK">;
  redis: Redis;
  clock: Clock;
  scheduler: Scheduler;
  webApi: WebApi;
  onRaceEnded?: (ended: RaceEnded) => void;
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
  });
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
    emit: (lobbyId, event) => void to(lobbyRoom(lobbyId))?.emit("event", event),
  });
  const race: RacePort = {
    ingest: (lobbyId, desk, batch) => ingest(desksState.get(lobbyId), desk, batch, clock.now()),
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
    onEnding: (lobbyId: string) => presence.settle(lobbyId),
    onGo: (lobbyId: string, init: Parameters<typeof desksState.open>[1]) => {
      desksState.open(lobbyId, init);
      presence.onGo(lobbyId);
      ticker.start(lobbyId);
    },
    onEnded: (lobbyId: string) => {
      ticker.finish(lobbyId);
      desksState.end(lobbyId);
    },
    onClosed: (lobbyId: string) => {
      ticker.stop(lobbyId);
      desksState.close(lobbyId);
      presence.closeRoom(lobbyId);
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
    listen: (port, host) =>
      new Promise((resolve) => {
        httpServer.listen(port, host, () => resolve((httpServer.address() as AddressInfo).port));
      }),
    close: async () => {
      draining = true;
      lifecycle.close();
      presence.close();
      ticker.close();
      outbox.close();
      await new Promise<void>((resolve) => void io.close(() => resolve()));
      await redis.quit().catch(() => undefined);
    },
  };
}
