import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Redis } from "ioredis";
import type { Clock } from "./clock";
import type { RaceServerEnv } from "./env";
import { createInternalHandler } from "./http/internal";
import { createHttpHandler } from "./http/router";
import { createRoomRegistry, type RoomRegistry } from "./rooms/registry";
import { attachSocketServer, type RaceIo } from "./socket/server";

export type RaceServer = {
  httpServer: HttpServer;
  io: RaceIo;
  registry: RoomRegistry;
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
}: {
  env: Pick<RaceServerEnv, "RACE_TOKEN_SECRET" | "WEB_ORIGIN">;
  redis: Redis;
  clock: Clock;
}): RaceServer {
  const registry = createRoomRegistry({ redis, clock });
  const secret = env.RACE_TOKEN_SECRET;
  let draining = false;

  const httpServer = createServer(
    createHttpHandler({
      health: { rooms: () => registry.count(), draining: () => draining },
      internal: createInternalHandler({ registry, secret, clock }),
    }),
  );
  const io = attachSocketServer(httpServer, { registry, secret, clock, origin: env.WEB_ORIGIN });

  return {
    httpServer,
    io,
    registry,
    listen: (port, host) =>
      new Promise((resolve) => {
        httpServer.listen(port, host, () => resolve((httpServer.address() as AddressInfo).port));
      }),
    close: async () => {
      draining = true;
      await new Promise<void>((resolve) => void io.close(() => resolve()));
      await redis.quit().catch(() => undefined);
    },
  };
}
