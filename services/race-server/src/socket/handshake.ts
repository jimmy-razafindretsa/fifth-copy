import type { ExtendedError, Socket } from "socket.io";
import {
  PROTOCOL_VERSION,
  handshakeAuthSchema,
  type RaceTokenClaims,
  type RejectReason,
} from "@fifth-copy/protocol";
import type { Clock } from "../clock";
import type { RoomRegistry } from "../rooms/registry";
import { verifyRaceToken } from "./race-token";

export type HandshakeDeps = { secret: string; registry: RoomRegistry; clock: Clock };
export type HandshakeResult =
  { ok: true; claims: RaceTokenClaims } | { ok: false; reason: RejectReason };

/**
 * Decides whether a Socket.IO handshake may proceed (ADR 0006, 0009). Order: protocol version, then
 * the auth shape and race token (any failure is `bad-token`), then the room of the token's `lobby`
 * claim, the only source of the room: a client never names one. Reads only; joining happens on connect.
 * A `spectator` token is refused as `bad-token` until the spectator channel exists (#187).
 */
export async function authenticateHandshake(
  auth: unknown,
  { secret, registry, clock }: HandshakeDeps,
): Promise<HandshakeResult> {
  if ((auth as { v?: unknown } | null | undefined)?.v !== PROTOCOL_VERSION) {
    return { ok: false, reason: "version" };
  }
  const parsed = handshakeAuthSchema.safeParse(auth);
  if (!parsed.success) return { ok: false, reason: "bad-token" };
  const verified = await verifyRaceToken(parsed.data.token, secret, Math.floor(clock.now() / 1000));
  if (!verified.ok) return { ok: false, reason: "bad-token" };
  if (verified.claims.role === "spectator") return { ok: false, reason: "bad-token" };
  if ((await registry.members(verified.claims.lobby)) === null) {
    return { ok: false, reason: "no-room" };
  }
  return { ok: true, claims: verified.claims };
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
        next();
      },
      () => next(new Error("no-room" satisfies RejectReason)),
    );
  };
}
