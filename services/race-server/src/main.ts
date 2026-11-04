/**
 * Race server entry point: env, Redis, then the composition root (`app.ts`: GET /health,
 * POST /internal/rooms, Socket.IO rooms and their lifecycle). SIGTERM (Railway replacing the
 * deployment, ADR 0019) drains: live races finish, new rooms go to the next deployment, exit when no
 * room is left or at RACE_DRAIN_CAP_S (#704). SIGINT (a developer's Ctrl-C) closes at once.
 */
import { createRaceServer } from "./app";
import { systemClock, systemScheduler } from "./clock";
import { drainingTooShort, parseEnv } from "./env";
import { createWebApi } from "./persist/web-api";
import { createRedis } from "./redis/client";

const log = (level: "info" | "warn", msg: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, msg, ...fields }));

const env = parseEnv();
if (drainingTooShort(env)) {
  log("warn", "draining time below drain cap", {
    drainingSeconds: env.RAILWAY_DEPLOYMENT_DRAINING_SECONDS,
    drainCapSeconds: env.RACE_DRAIN_CAP_S,
  });
}
const server = createRaceServer({
  env,
  redis: createRedis(env.REDIS_URL),
  clock: systemClock,
  scheduler: systemScheduler,
  // WEB_ORIGIN doubles as the web app's base URL for the signed internal API (#199).
  webApi: createWebApi({
    baseUrl: env.WEB_ORIGIN,
    secret: env.RACE_TOKEN_SECRET,
    clock: systemClock,
    scheduler: systemScheduler,
  }),
});

void server.listen(env.RACE_SERVER_PORT).then((port) => {
  log("info", "race-server listening", { port });
});

let stopping = false;
function exitAfterClose() {
  void server.close().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on("SIGTERM", () => {
  if (stopping) return;
  stopping = true;
  log("info", "race-server draining", { signal: "SIGTERM", rooms: server.registry.count() });
  void server.drain(env.RACE_DRAIN_CAP_S * 1000).then((outcome) => {
    log("info", "race-server drained", { outcome, rooms: server.registry.count() });
    exitAfterClose();
  });
});
process.on("SIGINT", () => {
  if (stopping) return;
  stopping = true;
  log("info", "race-server closing", { signal: "SIGINT", rooms: server.registry.count() });
  exitAfterClose();
});
