import type { IncomingMessage, ServerResponse } from "node:http";
import {
  INTERNAL_HEADERS,
  PROTOCOL_VERSION,
  openRoomRequestSchema,
  type InternalError,
  type OpenRoomResponse,
} from "@fifth-copy/protocol";
import type { Clock } from "../clock";
import type { RoomRegistry } from "../rooms/registry";
import { verifyInternalRequest } from "./hmac";

/** Internal request bodies are tiny JSON objects; anything larger is refused before hashing. */
export const MAX_INTERNAL_BODY_BYTES = 64 * 1024;

export type InternalRoute = {
  method: "POST" | "PATCH";
  path: string;
  /** Called only after the signature and timestamp verified; `body` is parsed JSON, not yet a schema. */
  handle(body: unknown): Promise<{ status: number; body: unknown }>;
};

type Deps = { registry: RoomRegistry; secret: string; clock: Clock };

const error = (status: number, code: InternalError["error"]) => ({
  status,
  body: { v: PROTOCOL_VERSION, error: code } satisfies InternalError,
});

/**
 * Web -> race server routes (ADR 0006 point 6). One entry per path: `PATCH /internal/rooms/:id/settings`
 * and `/close` land here later. Each handler parses its body with a protocol schema.
 */
export function internalRoutes({ registry }: Pick<Deps, "registry">): InternalRoute[] {
  return [
    {
      method: "POST",
      path: "/internal/rooms",
      async handle(body) {
        const parsed = openRoomRequestSchema.safeParse(body);
        if (!parsed.success) return error(400, "bad-body");
        const { lobbyId, code, hostUserId, settings } = parsed.data;
        const { created, room } = await registry.open({ lobbyId, code, hostUserId, settings });
        const res: OpenRoomResponse = {
          v: PROTOCOL_VERSION,
          roomId: room.roomId,
          phase: room.phase,
          created,
        };
        return { status: 200, body: res };
      },
    },
  ];
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_INTERNAL_BODY_BYTES) {
        resolve(null);
        req.removeAllListeners("data");
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function header(req: IncomingMessage, name: string) {
  const value = req.headers[name];
  return typeof value === "string" ? value : undefined;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Dispatcher for `/internal/*`: returns false when no route matches. Order is fixed: raw body, then
 * timestamp and signature, then JSON, then `v` (426), then the route's schema. Logs carry the path and
 * outcome only, never the secret, signature or body.
 */
export function createInternalHandler(deps: Deps, routes = internalRoutes(deps)) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = (req.url ?? "").split("?")[0];
    const route = routes.find((r) => r.method === req.method && r.path === path);
    if (!route) return false;

    const reply = ({ status, body }: { status: number; body: unknown }) => {
      const outcome = (body as { error?: string }).error ?? "ok";
      console.log(JSON.stringify({ level: "info", msg: "internal", path, status, outcome }));
      send(res, status, body);
    };

    const rawBody = await readBody(req);
    if (rawBody === null) return (reply(error(400, "bad-body")), true);
    const verified = verifyInternalRequest({
      secret: deps.secret,
      timestamp: header(req, INTERNAL_HEADERS.timestamp),
      signature: header(req, INTERNAL_HEADERS.signature),
      rawBody,
      nowMs: deps.clock.now(),
    });
    if (!verified.ok) return (reply(error(401, verified.error)), true);

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return (reply(error(400, "bad-body")), true);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return (reply(error(400, "bad-body")), true);
    if ((body as { v?: unknown }).v !== PROTOCOL_VERSION)
      return (reply(error(426, "version")), true);
    reply(await route.handle(body));
    return true;
  };
}
