import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Redis } from "ioredis";
import type { Clock, Scheduler } from "./clock";
import type { RaceServerEnv } from "./env";
import { createInternalHandler } from "./http/internal";
import { createHttpHandler } from "./http/router";
import type { WebApi } from "./persist/web-api";
import { durationsFor } from "./rooms/durations";
import { createLifecycle, type Lifecycle, type RaceEnded } from "./rooms/lifecycle";
import { createRoomRegistry, type RoomRegistry } from "./rooms/registry";
import { attachSocketServer, lobbyRoom, type RaceIo } from "./socket/server";

export type RaceServer = {
  httpServer: HttpServer;
  io: RaceIo;
  registry: RoomRegistry;
  lifecycle: Lifecycle;
  /** Resolves with the bound port (pass 0 for an ephemeral one in tests). */
  listen(port: number, host?: string): Promise<number>;
  /** Marks draining, disconnects every socket, closes HTTP, then quits Redis. */
  close(): Promise<void>;
};

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
  let broadcast: RaceIo | undefined;
  const lifecycle = createLifecycle({
    registry,
    clock,
    scheduler,
    webApi,
    durations: durationsFor(env),
    emit: (lobbyId, event, payload) => {
      // Socket.IO cannot narrow a generic event name to its payload; `Emit` types the pair.
      const room = broadcast?.to(lobbyRoom(lobbyId)) as
        { emit(e: string, p: unknown): boolean } | undefined;
      room?.emit(event, payload);
    },
    onRaceEnded,
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
  });
  broadcast = io;

  return {
    httpServer,
    io,
    registry,
    lifecycle,
    listen: (port, host) =>
      new Promise((resolve) => {
        httpServer.listen(port, host, () => resolve((httpServer.address() as AddressInfo).port));
      }),
    close: async () => {
      draining = true;
      lifecycle.close();
      await new Promise<void>((resolve) => void io.close(() => resolve()));
      await redis.quit().catch(() => undefined);
    },
  };
}
