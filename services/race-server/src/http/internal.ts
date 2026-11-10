import type { IncomingMessage, ServerResponse } from "node:http";
import {
  INTERNAL_HEADERS,
  PROTOCOL_VERSION,
  openRoomRequestSchema,
  roomStatusRequestSchema,
  roomTypeRequestSchema,
  type InternalError,
  type OpenRoomResponse,
  type RoomStatus,
  type RoomStatusResponse,
  type RoomTypeResponse,
  type RaceSettings,
} from "@fifth-copy/protocol";
import type { Clock } from "../clock";
import { ROOM_SEATS, type RoomRegistry } from "../rooms/registry";
import { verifyInternalRequest } from "./hmac";
import type { NonceStore } from "./nonces";

/** Internal request bodies are tiny JSON objects; anything larger is refused before hashing. */
export const MAX_INTERNAL_BODY_BYTES = 64 * 1024;

export type InternalRoute = {
  method: "POST" | "PATCH";
  path: string;
  /**
   * Called only after the timestamp, nonce and signature verified and the nonce was claimed; `body` is
   * parsed JSON, not yet a schema.
   */
  handle(
    body: unknown,
  ): Promise<{ status: number; body: unknown; headers?: Record<string, string> }>;
};

type Deps = {
  registry: RoomRegistry;
  secret: string;
  clock: Clock;
  nonces: NonceStore;
  /** SIGTERM drain (#704): new rooms are refused with a retryable 503. */
  draining?: () => boolean;
  /**
   * A room's visibility changed (#815): the composition root broadcasts the new settings and asks
   * the lifecycle to review the automatic start. Not called when the type was already stored.
   */
  onLobbyType?: (lobbyId: string, settings: RaceSettings) => void;
};

/** `Retry-After` of a room refused while draining (#704): the next deployment is already up. */
export const DRAIN_RETRY_AFTER_S = 2;

const error = (status: number, code: InternalError["error"]) => ({
  status,
  body: { v: PROTOCOL_VERSION, error: code } satisfies InternalError,
});

/**
 * Web -> race server routes (ADR 0006 point 6). One entry per path: `POST /internal/rooms` (open),
 * `POST /internal/rooms/status` (#806), `POST /internal/rooms/type` (#815); `PATCH /internal/rooms/:id/settings` and `/close` land here later. Each handler parses its body with a protocol schema.
 */
export function internalRoutes({
  registry,
  draining = () => false,
  onLobbyType = () => {},
}: Pick<Deps, "registry" | "draining" | "onLobbyType">): InternalRoute[] {
  return [
    {
      method: "POST",
      path: "/internal/rooms",
      async handle(body) {
        const parsed = openRoomRequestSchema.safeParse(body);
        if (!parsed.success) return error(400, "bad-body");
        // Outside the wire schemas like the router's 500: the web treats every non-200 as
        // `race-server-unavailable`, and the retry reaches the next deployment (#704).
        if (draining())
          return {
            status: 503,
            body: { error: "draining" },
            headers: { "retry-after": String(DRAIN_RETRY_AFTER_S) },
          };
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
    {
      // Room status lookup (#806): read only, so it answers while draining too. Counts only: the
      // body never carries names, user ids or settings.
      method: "POST",
      path: "/internal/rooms/status",
      async handle(body) {
        const parsed = roomStatusRequestSchema.safeParse(body);
        if (!parsed.success) return error(400, "bad-body");
        const lobbyIds = [...new Set(parsed.data.lobbyIds)];
        const found = await Promise.all(
          lobbyIds.map(async (lobbyId): Promise<RoomStatus | null> => {
            // A corrupt room hash is not joinable: left out like a missing room, never a 500
            // for the whole list. The log names the error class only (a parse error quotes values).
            const room = await registry.room(lobbyId).catch((err: unknown) => {
              const kind = err instanceof Error ? err.name : "unknown";
              console.log(JSON.stringify({ level: "warn", msg: "room status unreadable", kind }));
              return null;
            });
            if (!room) return null;
            const bots = room.seated.filter((desk) => desk.isBot).length;
            return {
              lobbyId,
              phase: room.phase,
              typists: room.seated.length - bots,
              bots,
              seats: ROOM_SEATS,
            };
          }),
        );
        const res: RoomStatusResponse = {
          v: PROTOCOL_VERSION,
          rooms: found.filter((room) => room !== null),
        };
        return { status: 200, body: res };
      },
    },
    {
      // The host filed PUBLIC or PRIVATE (#815, ADR 0008): the web writes `Lobby.type` only on `ok`.
      // Not refused while draining: it writes a live room, it opens none. The body is a result only.
      method: "POST",
      path: "/internal/rooms/type",
      async handle(body) {
        const parsed = roomTypeRequestSchema.safeParse(body);
        if (!parsed.success) return error(400, "bad-body");
        const { lobbyId, lobbyType } = parsed.data;
        const typed = await registry.setLobbyType(lobbyId, lobbyType);
        if (typed.ok && typed.changed) onLobbyType(lobbyId, typed.settings);
        const res: RoomTypeResponse = {
          v: PROTOCOL_VERSION,
          result: typed.ok ? "ok" : typed.reason,
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

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers?: Record<string, string>,
) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

/**
 * Dispatcher for `/internal/*`: returns false when no route matches. Order is fixed: raw body, then
 * timestamp, nonce format and signature, then the nonce claim (401 `replay` on reuse, #518; only a
 * correctly signed request may write to Redis, and a Redis error rejects to the router's 500, failing
 * closed), then JSON, then `v` (426), then the route's schema. Logs carry the path and outcome only,
 * never the secret, nonce, signature or body.
 */
export function createInternalHandler(deps: Deps, routes = internalRoutes(deps)) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = (req.url ?? "").split("?")[0];
    const route = routes.find((r) => r.method === req.method && r.path === path);
    if (!route) return false;

    const reply = ({
      status,
      body,
      headers,
    }: {
      status: number;
      body: unknown;
      headers?: Record<string, string>;
    }) => {
      const outcome = (body as { error?: string }).error ?? "ok";
      console.log(JSON.stringify({ level: "info", msg: "internal", path, status, outcome }));
      send(res, status, body, headers);
    };

    const rawBody = await readBody(req);
    if (rawBody === null) return (reply(error(400, "bad-body")), true);
    const nonce = header(req, INTERNAL_HEADERS.nonce);
    const verified = verifyInternalRequest({
      secret: deps.secret,
      timestamp: header(req, INTERNAL_HEADERS.timestamp),
      nonce,
      signature: header(req, INTERNAL_HEADERS.signature),
      rawBody,
      nowMs: deps.clock.now(),
    });
    if (!verified.ok) return (reply(error(401, verified.error)), true);
    // The verifier proved `nonce` present and well formed; the guard only narrows its type.
    if (nonce === undefined) return (reply(error(401, "bad-signature")), true);
    if (!(await deps.nonces.claim(nonce))) return (reply(error(401, "replay")), true);

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
