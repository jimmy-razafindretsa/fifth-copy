import type { Socket } from "socket.io";
import {
  abandonSchema,
  bonusPlaySchema,
  hostSettingsSchema,
  hostStartSchema,
  keysSchema,
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type HostSettingsAck,
  type HostStartAck,
  type RaceTokenClaims,
  type RoomCode,
  type ServerToClientEvents,
} from "@fifth-copy/protocol";
import type { Clock } from "../clock";
import type { RoomRegistry } from "../rooms/registry";
import { spectatorRoom } from "./rooms";

type SpectatorSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const log = (msg: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: "info", msg, ...fields }));

/**
 * The read-only edge of a `spectator` token (#187, ADR 0006 point 8, ARCHITECTURE 7.8). The socket
 * joins `spectatorRoom` only: it holds no desk and never reaches the registry's writes, presence,
 * resume keys or the race runtime, so a spectator carrying a member's own `sub` (the host's
 * projector tab) can neither shadow nor evict that member's desk. It hears every room-wide
 * broadcast (`audience`) and the desks' events. Every inbound payload is parsed first (a malformed
 * one is dropped, as on the seated edge); `keys`, `abandon` and `bonus:play` are `rejected
 * { spectator }`, `host:*` are acked `not-host`. `ping` is registered by the caller for every
 * socket. Disconnect leaves no trace: nothing to release.
 */
export function attachSpectator(
  socket: SpectatorSocket,
  claims: RaceTokenClaims,
  { registry, clock }: { registry: RoomRegistry; clock: Clock },
) {
  const { lobby, role } = claims;
  // Joined before the read, so no `roster` or `countdown` broadcast after it is missed.
  void socket.join(spectatorRoom(lobby));

  // Read in the room's queue: after any pending join, leave or start of that room.
  registry
    .withRoom(lobby, () => Promise.all([registry.room(lobby), registry.members(lobby)]))
    .then(([room, members]) => {
      if (!room || !members) return void socket.disconnect(true);
      socket.emit("welcome", {
        v: PROTOCOL_VERSION,
        role,
        you: null,
        room: { code: room.code as RoomCode, phase: room.phase },
        members,
        settings: room.settings,
        race: room.race,
        state: null,
        overlay: null,
        resumeKey: null,
        serverNow: clock.now(),
      });
      // A room voided by a restart (#204): the spectator hears the race is over, like a player.
      if (room.phase === "ended" && room.endReason === "void" && room.raceId !== null) {
        socket.emit("ended", {
          v: PROTOCOL_VERSION,
          raceId: room.raceId,
          reason: "void",
          ranking: [],
        });
      }
      log("spectating", { lobby, members: members.length });
    })
    .catch(() => {
      log("spectate failed", { lobby });
      socket.disconnect(true);
    });

  const refuse = (schema: { safeParse(raw: unknown): { success: boolean } }) => (raw: unknown) => {
    if (!schema.safeParse(raw).success) return;
    socket.emit("rejected", { v: PROTOCOL_VERSION, reason: "spectator" });
  };
  socket.on("keys", refuse(keysSchema));
  socket.on("abandon", refuse(abandonSchema));
  socket.on("bonus:play", refuse(bonusPlaySchema));

  // Answered through the ack only; a malformed request gets none, as on the seated edge.
  socket.on("host:start", (raw: unknown, ack: unknown) => {
    if (typeof ack !== "function" || !hostStartSchema.safeParse(raw).success) return;
    (ack as (a: HostStartAck) => void)({ ok: false, error: "not-host" });
  });
  socket.on("host:settings", (raw: unknown, ack: unknown) => {
    if (typeof ack !== "function") return;
    const reply = ack as (a: HostSettingsAck) => void;
    if (!hostSettingsSchema.safeParse(raw).success) return reply({ ok: false, error: "invalid" });
    reply({ ok: false, error: "not-host" });
  });
}
