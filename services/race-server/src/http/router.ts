import type { RequestListener } from "node:http";
import { createHealthHandler } from "../health";

/**
 * The race server's plain HTTP routes: `/internal/*` (HMAC) first, then GET /health (and its 404).
 * Socket.IO attaches to the same server and answers `/socket.io/*` before this listener runs.
 */
export function createHttpHandler(deps: {
  health: Parameters<typeof createHealthHandler>[0];
  internal: (...args: Parameters<RequestListener>) => Promise<boolean>;
}): RequestListener {
  const health = createHealthHandler(deps.health);
  return (req, res) => {
    deps.internal(req, res).then(
      (handled) => {
        if (!handled) health(req, res);
      },
      () => {
        console.error(JSON.stringify({ level: "error", msg: "internal route failed" }));
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal" }));
      },
    );
  };
}
