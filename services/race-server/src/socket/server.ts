import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { Keystroke } from "@fifth-copy/engine";
import {
  abandonSchema,
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
import type { AbandonResult } from "../players/idle";
import type { Presence } from "../players/presence";
import type { IngestResult } from "../rooms/ingest";
import type { Lifecycle } from "../rooms/lifecycle";
import { createHandshakeMiddleware, type HandshakeDeps } from "./handshake";
import { audience, deskRoom, lobbyRoom } from "./rooms";
import { attachSpectator } from "./spectator";

/**
 * Per-socket state: `claims` and `resume` (the handshake carried the user's own resume key, #178)
 * set by the handshake middleware from the verified race token, `desk` once the registry seated the
 * socket's user.
 */
export type SocketData = { claims: RaceTokenClaims; resume?: boolean; desk?: number };

/**
 * The live race behind the `keys` and `abandon` edges: `rooms/ingest.ts` over the desks' runtime
 * (#173), `players/idle.ts` for the abandon (#183).
 */
export type RacePort = {
  ingest(lobbyId: string, desk: number, batch: Keystroke[]): IngestResult;
  abandon(lobbyId: string, desk: number): AbandonResult;
  /** The desk's engine state while a race runs (`welcome.state`), else null. */
  stateOf(lobbyId: string, desk: number): Welcome["state"];
};

export type RaceIo = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type RaceSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

const log = (msg: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: "info", msg, ...fields }));

/**
 * The room's network edge (ADR 0006, ARCHITECTURE 7.1). Room rules stay in the registry: on connect
 * the socket's user joins (`welcome` to it with the user's resume key, `roster` to the room). What the
 * user's last disconnect means is presence's decision (`players/presence.ts`, #178): in `waiting` and
 * `ended` the desk is released (`roster`); during a race it is line-cut and kept for the grace. A
 * handshake with the user's own resume key resumes the desk, and its `welcome` carries the server's
 * state. Client events (`keys`, `abandon`, `host:*`, `ping`) register on the socket by name; phase transitions
 * belong to the lifecycle (`rooms/lifecycle.ts`, #166). A `spectator` token takes the read-only edge
 * (`spectator.ts`, #187) instead; room-wide broadcasts go to the `audience` (players and spectators).
 */
export function attachSocketServer(
  httpServer: HttpServer,
  deps: HandshakeDeps & {
    origin: string;
    lifecycle: Lifecycle;
    race: RacePort;
    presence: Presence;
  },
): RaceIo {
  const { registry, lifecycle, race, presence } = deps;
  const io: RaceIo = new Server(httpServer, {
    cors: { origin: deps.origin, credentials: false },
    transports: ["websocket", "polling"],
  });
  io.use(createHandshakeMiddleware(deps));

  io.on("connection", (socket: RaceSocket) => {
    const { lobby, sub, name, role } = socket.data.claims;
    const room = lobbyRoom(lobby);
    const everyone = audience(lobby);

    // Clock sync (#172): to the sender only, in any phase and any role. A malformed ping is dropped.
    socket.on("ping", (raw: unknown) => {
      const parsed = pingSchema.safeParse(raw);
      if (!parsed.success) return;
      socket.emit("pong", {
        v: PROTOCOL_VERSION,
        sent: parsed.data.sent,
        serverNow: deps.clock.now(),
      });
    });

    // A spectator (#187) branches off before anything below: it must never reach presence, the
    // registry's join/leave/settings or the race, whatever `sub` it carries (a host's projector tab).
    if (role === "spectator") {
      return attachSpectator(socket, socket.data.claims, { registry, clock: deps.clock });
    }
    // Two tabs of one user share a desk: presence counts the user's sockets on this process.
    presence.socketOpened(lobby, sub);
    void socket.join(room);

    // join, presence and leave go through the registry's per-room queue, so a disconnect that races
    // the join still runs after it. The desk comes from membership, never from the resume key.
    registry
      .join(lobby, { userId: sub, name })
      .then(async (joined) => {
        if (!joined.ok) return void socket.disconnect(true);
        socket.data.desk = joined.desk;
        void socket.join(deskRoom(lobby, joined.desk));
        const { resumeKey } = await presence.seated(
          lobby,
          sub,
          joined.desk,
          socket.data.resume === true,
        );
        // The phase may have moved on while presence waited in the queue.
        const now = await registry.room(lobby);
        const phase = now?.phase ?? joined.room.phase;
        socket.emit("welcome", {
          v: PROTOCOL_VERSION,
          role,
          you: joined.desk,
          // Parsed by openRoomRequestSchema when the room was opened.
          room: { code: joined.room.code as RoomCode, phase },
          members: joined.members,
          settings: joined.room.settings,
          race: joined.room.race,
          // The server's authority after a resume: the client reconciles from it (#215).
          state: race.stateOf(lobby, joined.desk),
          overlay: null,
          resumeKey,
          serverNow: deps.clock.now(),
        });
        // A room voided by a restart (#204): this socket hears the race is over, never a frozen race.
        if (now?.phase === "ended" && now.endReason === "void" && now.raceId !== null) {
          socket.emit("ended", {
            v: PROTOCOL_VERSION,
            raceId: now.raceId,
            reason: "void",
            ranking: [],
          });
        }
        io.to(everyone).emit("roster", { v: PROTOCOL_VERSION, members: joined.members });
        log("joined", { lobby, desk: joined.desk, members: joined.members.length });
      })
      .catch(() => {
        log("join failed", { lobby });
        socket.disconnect(true);
      });

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
          io.to(everyone).emit("settings", { v: PROTOCOL_VERSION, settings: result.settings });
          // A `bots` patch re-seated the room (#156): the bot desks changed.
          if (result.members) {
            io.to(everyone).emit("roster", { v: PROTOCOL_VERSION, members: result.members });
          }
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
    // batch or a socket not yet seated is dropped silently (spectators are refused by their own
    // edge, #187); a refusal by phase is `rejected` to the sender. No per-socket rate limit (#207).
    socket.on("keys", (raw: unknown) => {
      const parsed = keysSchema.safeParse(raw);
      const { desk } = socket.data;
      if (!parsed.success || desk === undefined) return;
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

    // Abandon (#183, ADR 0006): the desk is the socket's seat, never the payload. Dropped like
    // `keys` when malformed or unseated; refused (`not-running`) outside a running race
    // or once the desk stopped typing, so a replay changes nothing. No per-socket rate limit (#207).
    socket.on("abandon", (raw: unknown) => {
      const { desk } = socket.data;
      if (!abandonSchema.safeParse(raw).success || desk === undefined) return;
      const result = race.abandon(lobby, desk);
      if (result.rejected) {
        return void socket.emit("rejected", { v: PROTOCOL_VERSION, reason: result.rejected });
      }
      log("abandoned", { lobby, desk });
      lifecycle
        .onDeskTerminal(lobby)
        .catch((err: unknown) => log("desk terminal failed", { lobby, err: String(err) }));
    });

    socket.on("disconnect", () => {
      presence
        .socketClosed(lobby, sub)
        .then(async (closed) => {
          // A new socket of the user queued its join meanwhile: it keeps the desk.
          if (closed !== "leave" || presence.sockets(lobby, sub) > 0) return;
          const { members, closed: roomClosed } = await registry.leave(lobby, sub);
          if (roomClosed) lifecycle.onRoomClosed(lobby);
          else {
            await presence.left(lobby, sub);
            io.to(everyone).emit("roster", { v: PROTOCOL_VERSION, members });
          }
          log("left", { lobby, members: members.length, closed: roomClosed });
        })
        .catch(() => log("leave failed", { lobby }));
    });
  });

  return io;
}
