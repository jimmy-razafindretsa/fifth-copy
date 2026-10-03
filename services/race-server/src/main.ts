/**
 * Race server entry point. Today: an HTTP server with /health and graceful shutdown, so the
 * process, build, env and gates exist before the first feature card. Socket.IO, Redis and rooms
 * land through the cards of epic #148 (see docs/architecture/ARCHITECTURE.md section 11).
 */
import { createServer } from "node:http";
import { parseEnv } from "./env";
import { healthBody } from "./health";

const env = parseEnv();
const state = { rooms: 0, draining: false };

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    const body = healthBody(state);
    res.writeHead(body.ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(env.RACE_SERVER_PORT, () => {
  console.log(
    JSON.stringify({ level: "info", msg: "race-server listening", port: env.RACE_SERVER_PORT }),
  );
});

/** Drain: stop accepting work, let live rooms finish, then exit (ADR 0012 deploy rule). */
function shutdown(signal: string) {
  state.draining = true;
  console.log(
    JSON.stringify({ level: "info", msg: "race-server draining", signal, rooms: state.rooms }),
  );
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
