/**
 * Race server entry point: env, Redis, then the composition root (`app.ts`: GET /health,
 * POST /internal/rooms, Socket.IO rooms and their lifecycle). SIGTERM/SIGINT disconnect every socket and exit
 * (ADR 0012; docs/architecture/ARCHITECTURE.md section 11).
 */
import { createRaceServer } from "./app";
import { systemClock, systemScheduler } from "./clock";
import { parseEnv } from "./env";
import { unavailableWebApi } from "./persist/web-api";
import { createRedis } from "./redis/client";

const env = parseEnv();
const server = createRaceServer({
  env,
  redis: createRedis(env.REDIS_URL),
  clock: systemClock,
  scheduler: systemScheduler,
  // Until the HMAC client lands (#199) every host:start acks `start-failed`.
  webApi: unavailableWebApi,
});

void server.listen(env.RACE_SERVER_PORT).then((port) => {
  console.log(JSON.stringify({ level: "info", msg: "race-server listening", port }));
});

function shutdown(signal: string) {
  console.log(
    JSON.stringify({
      level: "info",
      msg: "race-server draining",
      signal,
      rooms: server.registry.count(),
    }),
  );
  void server.close().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
