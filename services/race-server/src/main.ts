/**
 * Race server entry point: boot and graceful shutdown. Wires env, Redis, the room registry and
 * GET /health. Socket.IO and the internal route land through the cards of epic #148 (see
 * docs/architecture/ARCHITECTURE.md section 11).
 */
import { createServer } from "node:http";
import { systemClock } from "./clock";
import { parseEnv } from "./env";
import { createHealthHandler } from "./health";
import { createRedis } from "./redis/client";
import { createRoomRegistry } from "./rooms/registry";

const env = parseEnv();
const redis = createRedis(env.REDIS_URL);
const registry = createRoomRegistry({ redis, clock: systemClock });
let draining = false;

const server = createServer(
  createHealthHandler({ rooms: () => registry.count(), draining: () => draining }),
);

server.listen(env.RACE_SERVER_PORT, () => {
  console.log(
    JSON.stringify({ level: "info", msg: "race-server listening", port: env.RACE_SERVER_PORT }),
  );
});

/** Drain: stop accepting work, let live rooms finish, then exit (ADR 0012 deploy rule). */
function shutdown(signal: string) {
  draining = true;
  console.log(
    JSON.stringify({ level: "info", msg: "race-server draining", signal, rooms: registry.count() }),
  );
  server.close(() => {
    void redis.quit().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
