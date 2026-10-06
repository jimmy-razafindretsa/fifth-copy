import { z } from "zod";
import { roomCodeSchema } from "./room-code";
import { versionSchema } from "./version";

/** Socket.IO handshake `auth` payload. */
export const handshakeAuthSchema = z.object({
  v: versionSchema,
  token: z.string().min(1),
});
export type HandshakeAuth = z.infer<typeof handshakeAuthSchema>;

/** Sent as the Socket.IO `connect_error` message when the handshake is refused. */
export const rejectReasonSchema = z.enum(["version", "bad-token", "no-room", "closed"]);
export type RejectReason = z.infer<typeof rejectReasonSchema>;

export const memberSchema = z.object({
  desk: z.int().min(1),
  name: z.string().min(1),
  isHost: z.boolean(),
});
export type Member = z.infer<typeof memberSchema>;

/** First event after a successful handshake: the joiner's desk, the room and everyone in it. */
export const welcomeSchema = z.object({
  v: versionSchema,
  you: z.int().min(1),
  room: z.object({ code: roomCodeSchema, phase: z.literal("waiting") }),
  members: z.array(memberSchema),
});
export type Welcome = z.infer<typeof welcomeSchema>;

/** Broadcast whenever the waiting room's membership changes. */
export const rosterSchema = z.object({
  v: versionSchema,
  members: z.array(memberSchema),
});
export type Roster = z.infer<typeof rosterSchema>;

/** Server -> client event map. A later event is one schema plus one key here. */
export const serverEvents = {
  welcome: welcomeSchema,
  roster: rosterSchema,
} as const;

/** Typed Socket.IO generics: `Server<ClientToServerEvents, ServerToClientEvents>`. */
export type ServerToClientEvents = {
  [K in keyof typeof serverEvents]: (payload: z.infer<(typeof serverEvents)[K]>) => void;
};
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type ClientToServerEvents = {};
