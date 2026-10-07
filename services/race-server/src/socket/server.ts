import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import {
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type RaceTokenClaims,
  type RoomCode,
  type ServerToClientEvents,
} from "@fifth-copy/protocol";
import { createHandshakeMiddleware, type HandshakeDeps } from "./handshake";

/** Per-socket state, set by the handshake middleware from the verified race token. */
export type SocketData = { claims: RaceTokenClaims };

export type RaceIo = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type RaceSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

export const lobbyRoom = (lobbyId: string) => `lobby:${lobbyId}`;

const log = (msg: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: "info", msg, ...fields }));

/**
 * The waiting room's network edge (ADR 0006, ARCHITECTURE 7.1). Room rules stay in the registry: on
 * connect the socket's user joins (`welcome` to it, `roster` to the room); the desk is released when
 * the user's last socket disconnects. Client events (`keys`, `host:*`) register on the socket by name.
 */
export function attachSocketServer(
  httpServer: HttpServer,
  deps: HandshakeDeps & { origin: string },
): RaceIo {
  const { registry } = deps;
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
        socket.emit("welcome", {
          v: PROTOCOL_VERSION,
          role,
          you: joined.desk,
          // Parsed by openRoomRequestSchema when the room was opened.
          room: { code: joined.room.code as RoomCode, phase: joined.room.phase },
          members: joined.members,
          settings: joined.room.settings,
          // No race yet: start (#166) and resume (#178) fill these.
          race: null,
          state: null,
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

    socket.on("disconnect", () => {
      const left = (sockets.get(key) ?? 1) - 1;
      if (left > 0) return void sockets.set(key, left);
      sockets.delete(key);
      registry.leave(lobby, sub).then(
        ({ members, closed }) => {
          if (!closed) io.to(room).emit("roster", { v: PROTOCOL_VERSION, members });
          log("left", { lobby, members: members.length, closed });
        },
        () => log("leave failed", { lobby }),
      );
    });
  });

  return io;
}
