import type { ExtendedError, Socket } from "socket.io";
import {
  PROTOCOL_VERSION,
  handshakeAuthSchema,
  type RaceTokenClaims,
  type RejectReason,
} from "@fifth-copy/protocol";
import type { Clock } from "../clock";
import type { ResumeKeys } from "../players/resume-keys";
import type { RoomRegistry } from "../rooms/registry";
import { verifyRaceToken } from "./race-token";
import type { SpectatorSlots } from "./spectator-slots";

export type HandshakeDeps = {
  secret: string;
  registry: RoomRegistry;
  clock: Clock;
  /** Resume key resolution (#178); without it no handshake resumes. */
  resumeKeys?: Pick<ResumeKeys, "lookup">;
  /** Per-room spectator admission (#616); without it spectators are not capped. */
  spectators?: SpectatorSlots;
};
/**
 * `resume`: the handshake carried the user's own resume key for this room while a race is on
 * (countdown or running); the socket edge then resumes its line-cut desk (#178).
 */
export type HandshakeResult =
  { ok: true; claims: RaceTokenClaims; resume: boolean } | { ok: false; reason: RejectReason };

/**
 * Decides whether a Socket.IO handshake may proceed (ADR 0006, 0009). Order: protocol version, then
 * the auth shape and race token (any failure is `bad-token`), then the room of the token's `lobby`
 * claim, the only source of the room: a client never names one; then `in-progress` for a new user of
 * a started room. Reads only; joining happens on connect.
 * A `spectator` token (#187, ADR 0006 point 8) needs only its room: it is let in in every phase,
 * member or not, and never resumes (its `resumeKey` is not even looked up): it never takes a desk.
 * Last, `auth.resumeKey` (#178, ADR 0009): read only after all of the above passed and only while a
 * race is on; it resumes only when it resolves to this token's `lobby` and `sub`. Any other key
 * (another user's, another lobby's, made up, expired, or a failed lookup) is ignored: a plain join.
 * The key never grants access on its own and is never logged.
 */
export async function authenticateHandshake(
  auth: unknown,
  { secret, registry, clock, resumeKeys }: HandshakeDeps,
): Promise<HandshakeResult> {
  if ((auth as { v?: unknown } | null | undefined)?.v !== PROTOCOL_VERSION) {
    return { ok: false, reason: "version" };
  }
  const parsed = handshakeAuthSchema.safeParse(auth);
  if (!parsed.success) return { ok: false, reason: "bad-token" };
  const verified = await verifyRaceToken(parsed.data.token, secret, Math.floor(clock.now() / 1000));
  if (!verified.ok) return { ok: false, reason: "bad-token" };
  const room = await registry.room(verified.claims.lobby);
  if (room === null) return { ok: false, reason: "no-room" };
  if (verified.claims.role === "spectator")
    return { ok: true, claims: verified.claims, resume: false };
  // Once started, only an existing member (a second tab, same `sub`) is let in (#166).
  if (
    room.phase !== "waiting" &&
    !(await registry.hasMember(verified.claims.lobby, verified.claims.sub))
  ) {
    return { ok: false, reason: "in-progress" };
  }
  const { resumeKey } = parsed.data;
  const raceOn = room.phase === "countdown" || room.phase === "running";
  if (!resumeKey || !raceOn || !resumeKeys) {
    return { ok: true, claims: verified.claims, resume: false };
  }
  const entry = await resumeKeys.lookup(resumeKey).catch(() => null);
  const resume = entry?.lobbyId === verified.claims.lobby && entry.userId === verified.claims.sub;
  return { ok: true, claims: verified.claims, resume };
}

const refused = (reason: RejectReason) =>
  console.log(JSON.stringify({ level: "info", msg: "handshake refused", reason }));

/**
 * Takes a spectator slot of the socket's room (#616), the write `authenticateHandshake` never does.
 * Runs synchronously after the middleware's awaits: a client gone meanwhile reserves nothing, since
 * Socket.IO then fires neither `connection` nor `disconnect` for it (4.8 `Namespace._add`). A
 * held slot is released once, on the socket's `disconnect` or its connection's `close`, whichever
 * comes first (a client may open several sockets on one connection, or close mid-connect).
 */
function reserveSpectator(socket: Socket, lobbyId: string, slots: SpectatorSlots): boolean {
  if (socket.conn.readyState !== "open") return true;
  if (!slots.reserve(lobbyId)) return false;
  const release = () => {
    socket.off("disconnect", release);
    socket.conn.off("close", release);
    slots.release(lobbyId);
  };
  socket.once("disconnect", release);
  socket.conn.once("close", release);
  return true;
}

/**
 * Socket.IO middleware: refusal is `connect_error` with the reason as its message. A `spectator`
 * past the room's cap is refused `room-full` (#616); seated roles never take a slot.
 */
export function createHandshakeMiddleware(deps: HandshakeDeps) {
  return (socket: Socket, next: (err?: ExtendedError) => void) => {
    authenticateHandshake(socket.handshake.auth, deps).then(
      (result) => {
        if (!result.ok) {
          refused(result.reason);
          return next(new Error(result.reason));
        }
        const { spectators } = deps;
        if (
          result.claims.role === "spectator" &&
          spectators &&
          !reserveSpectator(socket, result.claims.lobby, spectators)
        ) {
          refused("room-full");
          return next(new Error("room-full" satisfies RejectReason));
        }
        socket.data.claims = result.claims;
        socket.data.resume = result.resume;
        next();
      },
      () => next(new Error("no-room" satisfies RejectReason)),
    );
  };
}
