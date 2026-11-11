import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { Keystroke } from "@fifth-copy/engine";
import type { Limiter } from "@fifth-copy/limiter";
import {
  abandonSchema,
  bonusPlaySchema,
  hostKickSchema,
  hostSettingsSchema,
  hostStartSchema,
  keysSchema,
  pingSchema,
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type HostKickAck,
  type HostSettingsAck,
  type HostStartAck,
  type RaceTokenClaims,
  type RoomCode,
  type ServerToClientEvents,
  type Welcome,
} from "@fifth-copy/protocol";
import type { AbandonResult } from "../players/idle";
import type { LastLeave } from "../players/last-leave";
import { leaveRoom, type LeaveDeps } from "../players/leave";
import type { BonusPlayResult } from "../rooms/bonus-step";
import type { Presence } from "../players/presence";
import type { IngestResult } from "../rooms/ingest";
import type { Lifecycle } from "../rooms/lifecycle";
import { createHandshakeMiddleware, type HandshakeDeps } from "./handshake";
import { createSocketGuard } from "./rate-limit";
import { audience, deskRoom, lobbyRoom } from "./rooms";
import { attachSpectator } from "./spectator";

/**
 * Per-socket state: `claims` and `resume` (the handshake carried the user's own resume key, #178)
 * set by the handshake middleware from the verified race token, `desk` once the registry seated the
 * socket's user.
 */
export type SocketData = {
  claims: RaceTokenClaims;
  resume?: boolean;
  desk?: number;
  /** The host removed this socket's user (#133): its seat is already freed, its leave is skipped. */
  removed?: boolean;
};

/**
 * The live race behind the `keys`, `abandon` and `bonus:play` edges: `rooms/ingest.ts` over the
 * desks' runtime (#173), `players/idle.ts` for the abandon (#183), `rooms/bonus-step.ts` (#190).
 */
export type RacePort = {
  ingest(lobbyId: string, desk: number, batch: Keystroke[]): IngestResult;
  abandon(lobbyId: string, desk: number): AbandonResult;
  playBonus(lobbyId: string, desk: number): BonusPlayResult;
  /** The desk's text overlay while a race runs (`welcome.overlay`), else null. */
  overlayOf(lobbyId: string, desk: number): Welcome["overlay"];
  /** The desk's card, cooldown end and blur end while a race runs (`welcome.bonus`, #768), else null. */
  bonusOf(lobbyId: string, desk: number): Welcome["bonus"];
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
 * state. Client events (`keys`, `abandon`, `bonus:play`, `host:*`, `ping`) register on the socket by name; phase transitions
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
    /** The shared Redis limiter behind the per-identity buckets (#207, `rate-limit.ts`). */
    limiter: Limiter;
    /** Queues the web's lobby close when a leave closes the room (#734, `LeaveDeps.onLobbyClosed`). */
    onLobbyClosed: (lobbyId: string) => void;
    /** A leave passed the host role on (#137, `LeaveDeps.onNewHost`): `new-host` and the web's record. */
    onNewHost: LeaveDeps["onNewHost"];
    /** The grace before the last human's leave closes a waiting room (#734: a reload keeps it). */
    lastLeave: LastLeave;
  },
): RaceIo {
  const { registry, lifecycle, race, presence } = deps;
  const leaveDeps: LeaveDeps = {
    registry,
    presence,
    onRoomClosed: (lobbyId) => lifecycle.onRoomClosed(lobbyId),
    onLobbyClosed: deps.onLobbyClosed,
    onNewHost: deps.onNewHost,
    announce: (lobbyId, members) =>
      void io.to(audience(lobbyId)).emit("roster", { v: PROTOCOL_VERSION, members }),
  };
  const io: RaceIo = new Server(httpServer, {
    cors: { origin: deps.origin, credentials: false },
    transports: ["websocket", "polling"],
  });
  io.use(createHandshakeMiddleware(deps));
  const guard = createSocketGuard({ limiter: deps.limiter, clock: deps.clock, log });

  io.on("connection", (socket: RaceSocket) => {
    const { lobby, sub, name, role } = socket.data.claims;
    const room = lobbyRoom(lobby);
    const everyone = audience(lobby);
    // Rate limits, payload cap and socket cap (#207) run before every handler below, spectators
    // included. A socket past its identity's cap is refused and closed before it joins anything.
    if (!guard.admit(socket, { lobby, sub, role })) return;

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
          overlay: race.overlayOf(lobby, joined.desk),
          bonus: race.bonusOf(lobby, joined.desk),
          resumeKey,
          serverNow: deps.clock.now(),
          // A reload or a reconnect during a public room's countdown sees it (#814).
          autoStartAt: now?.autoStartAt ?? null,
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
        // Eligibility is the lifecycle's one decision (#814); the edge only asks for a review.
        void lifecycle.reviewAutoStart(lobby);
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
          // A `bots` patch, or a language change with bots, re-seated the room (#156, #361).
          if (result.members) {
            io.to(everyone).emit("roster", { v: PROTOCOL_VERSION, members: result.members });
            void lifecycle.reviewAutoStart(lobby);
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

    // Host removal (#133, ARCHITECTURE 7.1, 7.2): the registry authorises (`sub` against the room's
    // `hostUserId`, ADR 0009; `waiting`/`ended` only; never a bot or the host's desk) and blocks the
    // user under the room's queue; the seat is freed through `leaveRoom` (roster to the room), then
    // the room hears `kicked` (the removed sockets included) and the user's sockets are closed
    // after it (no close of the transport: the event is flushed first). Malformed: no ack.
    socket.on("host:kick", (raw: unknown, ack: unknown) => {
      const reply = typeof ack === "function" ? (ack as (a: HostKickAck) => void) : () => {};
      const parsed = hostKickSchema.safeParse(raw);
      if (!parsed.success) return log("kick", { lobby, outcome: "invalid" });
      const { desk } = parsed.data;
      registry
        .kick(lobby, sub, desk)
        .then(async (result) => {
          log("kick", { lobby, desk, outcome: result.ok ? "ok" : result.reason });
          if (!result.ok) {
            return reply({
              ok: false,
              // A room gone meanwhile is no waiting room: nothing to remove.
              error: result.reason === "no-room" ? "not-waiting" : result.reason,
            });
          }
          const removed = (await io.in(room).fetchSockets()).filter(
            (s) => s.data.claims.sub === result.userId,
          );
          for (const s of removed) s.data.removed = true;
          await leaveRoom(leaveDeps, lobby, result.userId);
          io.to(everyone).emit("event", { v: PROTOCOL_VERSION, kind: "kicked", desk });
          for (const s of removed) s.disconnect();
          reply({ ok: true });
          void lifecycle.reviewAutoStart(lobby);
        })
        // No wire code for a Redis failure: no ack; the client times out.
        .catch(() => log("kick failed", { lobby, desk }));
    });

    // Keystrokes (#173, ADR 0006 point 3): parsed here, applied by the runtime only. A malformed
    // batch or a socket not yet seated is dropped silently (spectators are refused by their own
    // edge, #187); a refusal by phase is `rejected` to the sender. Rate limited per identity (#207).
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
    // or once the desk stopped typing, so a replay changes nothing. Rate limited per identity (#207).
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

    // Bonus play (#190, ADR 0006, 0016): the desk is the socket's seat, the card the one the server
    // dealt it, the targets the engine's; the payload carries nothing else. Dropped when malformed
    // or unseated; every refusal (phase, bonuses off, no card, cooldown, nothing to hit) is one
    // `rejected` to the sender and nothing broadcast. Rate limited per identity (#207).
    socket.on("bonus:play", (raw: unknown) => {
      const { desk } = socket.data;
      if (!bonusPlaySchema.safeParse(raw).success || desk === undefined) return;
      const result = race.playBonus(lobby, desk);
      if (result.rejected) {
        return void socket.emit("rejected", { v: PROTOCOL_VERSION, reason: result.rejected });
      }
      if (result.terminal) {
        lifecycle
          .onDeskTerminal(lobby)
          .catch((err: unknown) => log("desk terminal failed", { lobby, err: String(err) }));
      }
    });

    socket.on("disconnect", () => {
      presence
        .socketClosed(lobby, sub)
        .then(async (closed) => {
          // A new socket of the user queued its join meanwhile: it keeps the desk. A removed
          // user's seat was freed by the kick (#133): no second leave, no second roster.
          if (closed !== "leave" || presence.sockets(lobby, sub) > 0) return;
          if (socket.data.removed) return;
          const leave = async () => {
            const { members, closed: roomClosed } = await leaveRoom(leaveDeps, lobby, sub);
            log("left", { lobby, members: members.length, closed: roomClosed });
            // A closed room's timers went with `onRoomClosed`; nothing is told to an empty room.
            if (!roomClosed) void lifecycle.reviewAutoStart(lobby);
          };
          // The last human of a waiting room (#734): a reload must not close the room or its
          // lobby, so the leave waits out the grace and is dropped if a socket of the user is back.
          // The host with others in the room (#137, #884): a reload of the lobby page or the Dawn
          // report must not pass the role on, so it passes only if the host is still away after
          // the same grace.
          if (
            (await deps.lastLeave.closes(lobby, sub)) ||
            (await deps.lastLeave.hostWithOthers(lobby, sub))
          )
            return deps.lastLeave.defer(lobby, sub, leave);
          await leave();
        })
        .catch(() => log("leave failed", { lobby }));
    });
  });

  return io;
}
