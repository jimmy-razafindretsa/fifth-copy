import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { Keystroke } from "@fifth-copy/engine";
import {
  hostSettingsSchema,
  hostStartSchema,
  keysSchema,
  pingSchema,
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type HostSettingsAck,
  type HostStartAck,
  type RaceTokenClaims,
  type RoomCode,
  type ServerToClientEvents,
  type Welcome,
} from "@fifth-copy/protocol";
import type { IngestResult } from "../rooms/ingest";
import type { Lifecycle } from "../rooms/lifecycle";
import { createHandshakeMiddleware, type HandshakeDeps } from "./handshake";

/**
 * Per-socket state: `claims` and `resume` (the handshake carried the user's own resume key, #178)
 * set by the handshake middleware from the verified race token, `desk` once the registry seated the
 * socket's user.
 */
export type SocketData = { claims: RaceTokenClaims; resume?: boolean; desk?: number };

/** The live race behind the `keys` edge (#173): `rooms/ingest.ts` over the desks' runtime. */
export type RacePort = {
  ingest(lobbyId: string, desk: number, batch: Keystroke[]): IngestResult;
  /** The desk's engine state while a race runs (`welcome.state`), else null. */
  stateOf(lobbyId: string, desk: number): Welcome["state"];
};

export type RaceIo = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type RaceSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

export const lobbyRoom = (lobbyId: string) => `lobby:${lobbyId}`;
/** The sockets of one desk (a user's tabs): per-desk events such as `overtake` (#173). */
export const deskRoom = (lobbyId: string, desk: number) => `lobby:${lobbyId}:desk:${desk}`;

const log = (msg: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: "info", msg, ...fields }));

/**
 * The waiting room's network edge (ADR 0006, ARCHITECTURE 7.1). Room rules stay in the registry: on
 * connect the socket's user joins (`welcome` to it, `roster` to the room); the desk is released when
 * the user's last socket disconnects. Client events (`keys`, `host:*`, `ping`) register on the socket
 * by name; phase transitions belong to the lifecycle (`rooms/lifecycle.ts`, #166).
 */
export function attachSocketServer(
  httpServer: HttpServer,
  deps: HandshakeDeps & { origin: string; lifecycle: Lifecycle; race: RacePort },
): RaceIo {
  const { registry, lifecycle, race } = deps;
  const io: RaceIo = new Server(httpServer, {
    cors: { origin: deps.origin, credentials: false },
    transports: ["websocket", "polling"],
  });
  io.use(createHandshakeMiddleware(deps));

  // Sockets per (lobby, user) on this process: two tabs of one user share a desk.
  const sockets = new Map<string, number>();

  io.on("connection", (socket: RaceSocket) => {
    const { lobby, sub, name, role } = socket.data.claims;
    const key = `${lobby}\u0000${sub}`;
    const room = lobbyRoom(lobby);
    sockets.set(key, (sockets.get(key) ?? 0) + 1);
    void socket.join(room);

    // join and leave go through the registry's per-room queue, so a disconnect that races the join
    // still runs after it.
    registry.join(lobby, { userId: sub, name }).then(
      (joined) => {
        if (!joined.ok) return void socket.disconnect(true);
        socket.data.desk = joined.desk;
        void socket.join(deskRoom(lobby, joined.desk));
        socket.emit("welcome", {
          v: PROTOCOL_VERSION,
          role,
          you: joined.desk,
          // Parsed by openRoomRequestSchema when the room was opened.
          room: { code: joined.room.code as RoomCode, phase: joined.room.phase },
          members: joined.members,
          settings: joined.room.settings,
          race: joined.room.race,
          // Resume (#178) fills the rest.
          state: race.stateOf(lobby, joined.desk),
          overlay: null,
          resumeKey: null,
          serverNow: deps.clock.now(),
        });
        io.to(room).emit("roster", { v: PROTOCOL_VERSION, members: joined.members });
        log("joined", { lobby, desk: joined.desk, members: joined.members.length });
      },
      () => {
        log("join failed", { lobby });
        socket.disconnect(true);
      },
    );

    // Registered synchronously with the join: the registry's per-room queue runs it after the join.
    // The host is the token's `sub` matched against the room's `hostUserId` (ADR 0009), never `role`.
    socket.on("host:settings", (raw: unknown, ack: unknown) => {
      const reply = typeof ack === "function" ? (ack as (a: HostSettingsAck) => void) : () => {};
      const parsed = hostSettingsSchema.safeParse(raw);
      if (!parsed.success) {
        log("settings", { lobby, outcome: "invalid" });
        return reply({ ok: false, error: "invalid" });
      }
      // Keys only, never values: the strict patch schema bounds them to known setting names.
      const keys = Object.keys(parsed.data.patch);
      registry.updateSettings(lobby, sub, parsed.data.patch).then(
        (result) => {
          log("settings", { lobby, outcome: result.ok ? "ok" : result.reason, keys });
          if (!result.ok) return reply({ ok: false, error: result.reason });
          io.to(room).emit("settings", { v: PROTOCOL_VERSION, settings: result.settings });
          reply({ ok: true, settings: result.settings });
        },
        // No wire code for a Redis failure: no ack, no broadcast; the client times out.
        () => log("settings failed", { lobby, keys }),
      );
    });

    // Answered only through the ack (`rejected` is for unsolicited refusals). The lifecycle
    // authorises (token role and `sub` against the room's host), so this edge only parses.
    socket.on("host:start", (raw: unknown, ack: unknown) => {
      const reply = typeof ack === "function" ? (ack as (a: HostStartAck) => void) : () => {};
      if (!hostStartSchema.safeParse(raw).success) {
        // No wire code for a malformed start: no ack, the client times out.
        return log("start", { lobby, outcome: "invalid" });
      }
      void lifecycle.start(lobby, { sub, role }).then(reply);
    });

    // Keystrokes (#173, ADR 0006 point 3): parsed here, applied by the runtime only. A malformed
    // batch, a socket not yet seated or a spectator is dropped silently; a refusal by phase is
    // `rejected` to the sender. No per-socket rate limit yet (#207).
    socket.on("keys", (raw: unknown) => {
      const parsed = keysSchema.safeParse(raw);
      const { desk } = socket.data;
      if (!parsed.success || desk === undefined || role === "spectator") return;
      const result = race.ingest(lobby, desk, parsed.data.batch);
      if (result.rejected) {
        socket.emit("rejected", { v: PROTOCOL_VERSION, reason: result.rejected });
      }
      if (result.terminal) {
        lifecycle
          .onDeskTerminal(lobby)
          .catch((err: unknown) => log("desk terminal failed", { lobby, err: String(err) }));
      }
    });

    // Clock sync (#172): to the sender only, in any phase. A malformed ping is dropped.
    socket.on("ping", (raw: unknown) => {
      const parsed = pingSchema.safeParse(raw);
      if (!parsed.success) return;
      socket.emit("pong", {
        v: PROTOCOL_VERSION,
        sent: parsed.data.sent,
        serverNow: deps.clock.now(),
      });
    });

    socket.on("disconnect", () => {
      const left = (sockets.get(key) ?? 1) - 1;
      if (left > 0) return void sockets.set(key, left);
      sockets.delete(key);
      registry.leave(lobby, sub).then(
        ({ members, closed }) => {
          if (closed) lifecycle.onRoomClosed(lobby);
          else io.to(room).emit("roster", { v: PROTOCOL_VERSION, members });
          log("left", { lobby, members: members.length, closed });
        },
        () => log("leave failed", { lobby }),
      );
    });
  });

  return io;
}
