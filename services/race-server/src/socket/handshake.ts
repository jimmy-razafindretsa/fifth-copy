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

export type HandshakeDeps = {
  secret: string;
  registry: RoomRegistry;
  clock: Clock;
  /** Resume key resolution (#178); without it no handshake resumes. */
  resumeKeys?: Pick<ResumeKeys, "lookup">;
};
/**
 * `resume`: the handshake carried the user's own resume key for this room while a race is on
 * (countdown or running); the socket edge then resumes its line-cut desk (#178).
 */
export type HandshakeResult =
  | { ok: true; claims: RaceTokenClaims; resume: boolean }
  | { ok: false; reason: RejectReason };

/**
 * Decides whether a Socket.IO handshake may proceed (ADR 0006, 0009). Order: protocol version, then
 * the auth shape and race token (any failure is `bad-token`), then the room of the token's `lobby`
 * claim, the only source of the room: a client never names one; then `in-progress` for a new user of
 * a started room. Reads only; joining happens on connect.
 * A `spectator` token is refused as `bad-token` until the spectator channel exists (#187).
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
  if (verified.claims.role === "spectator") return { ok: false, reason: "bad-token" };
  const room = await registry.room(verified.claims.lobby);
  if (room === null) return { ok: false, reason: "no-room" };
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

/** Socket.IO middleware: refusal is `connect_error` with the reason as its message. */
export function createHandshakeMiddleware(deps: HandshakeDeps) {
  return (socket: Socket, next: (err?: ExtendedError) => void) => {
    authenticateHandshake(socket.handshake.auth, deps).then(
      (result) => {
        if (!result.ok) {
          console.log(
            JSON.stringify({ level: "info", msg: "handshake refused", reason: result.reason }),
          );
          return next(new Error(result.reason));
        }
        socket.data.claims = result.claims;
        socket.data.resume = result.resume;
        next();
      },
      () => next(new Error("no-room" satisfies RejectReason)),
    );
  };
}
