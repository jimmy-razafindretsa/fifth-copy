import { z } from "zod";
import { roomCodeSchema } from "./room-code";
import { raceSettingsPatchSchema, raceSettingsSchema } from "./settings";
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

/** First event after a successful handshake: the joiner's desk, the room, everyone in it, the settings. */
export const welcomeSchema = z.object({
  v: versionSchema,
  you: z.int().min(1),
  room: z.object({ code: roomCodeSchema, phase: z.literal("waiting") }),
  members: z.array(memberSchema),
  settings: raceSettingsSchema,
});
export type Welcome = z.infer<typeof welcomeSchema>;

/** Broadcast whenever the waiting room's membership changes. */
export const rosterSchema = z.object({
  v: versionSchema,
  members: z.array(memberSchema),
});
export type Roster = z.infer<typeof rosterSchema>;

/** Broadcast to the room whenever the host changes a setting: the full settings after the change. */
export const settingsSchema = z.object({
  v: versionSchema,
  settings: raceSettingsSchema,
});
export type SettingsEvent = z.infer<typeof settingsSchema>;

/** Client -> server, host only, waiting phase only: change some settings. */
export const hostSettingsSchema = z.object({
  v: versionSchema,
  patch: raceSettingsPatchSchema,
});
export type HostSettings = z.infer<typeof hostSettingsSchema>;

/** Acknowledgement of `host:settings`: the settings after the change, or why nothing changed. */
export const hostSettingsAckSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), settings: raceSettingsSchema }),
  z.object({
    ok: z.literal(false),
    error: z.enum(["not-host", "not-waiting", "invalid", "no-room"]),
  }),
]);
export type HostSettingsAck = z.infer<typeof hostSettingsAckSchema>;

/** Server -> client event map. A later event is one schema plus one key here. */
export const serverEvents = {
  welcome: welcomeSchema,
  roster: rosterSchema,
  settings: settingsSchema,
} as const;

/** Client -> server event map. A later event is one schema here plus its ack in `clientAcks`. */
export const clientEvents = {
  "host:settings": hostSettingsSchema,
} as const;

/** Acknowledgement schema of each client event (same keys as `clientEvents`). */
export const clientAcks = {
  "host:settings": hostSettingsAckSchema,
} as const satisfies Record<keyof typeof clientEvents, z.ZodType>;

/** Typed Socket.IO generics: `Server<ClientToServerEvents, ServerToClientEvents>`. */
export type ServerToClientEvents = {
  [K in keyof typeof serverEvents]: (payload: z.infer<(typeof serverEvents)[K]>) => void;
};
export type ClientToServerEvents = {
  [K in keyof typeof clientEvents]: (
    payload: z.infer<(typeof clientEvents)[K]>,
    ack: (a: z.infer<(typeof clientAcks)[K]>) => void,
  ) => void;
};
