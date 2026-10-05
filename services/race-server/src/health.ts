import type { RequestListener } from "node:http";
import { PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { ENGINE_VERSION } from "@fifth-copy/engine";

export type Health = {
  ok: boolean;
  service: "race-server";
  engine: string;
  protocol: number;
  /** Live rooms; the deploy job waits for 0 before replacing the process (ADR 0012). */
  rooms: number;
  draining: boolean;
};

/** Pure so it can be unit-tested; createHealthHandler wires it to GET /health. */
export function healthBody(state: { rooms: number; draining: boolean }): Health {
  return {
    ok: !state.draining,
    service: "race-server",
    engine: ENGINE_VERSION,
    protocol: PROTOCOL_VERSION,
    rooms: state.rooms,
    draining: state.draining,
  };
}

/** HTTP handler: GET /health from live sources (rooms = registry.count()), 404 for anything else. */
export function createHealthHandler(source: {
  rooms: () => number;
  draining: () => boolean;
}): RequestListener {
  return (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const body = healthBody({ rooms: source.rooms(), draining: source.draining() });
      res.writeHead(body.ok ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  };
}
