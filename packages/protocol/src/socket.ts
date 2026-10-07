import { z } from "zod";
import {
  abandonSchema,
  bonusPlaySchema,
  countdownSchema,
  endedSchema,
  eventSchema,
  hostStartAckSchema,
  hostStartSchema,
  keysSchema,
  pingSchema,
  pongSchema,
  rejectedSchema,
  snapshotSchema,
} from "./events";
import {
  DESK_COLORS,
  deskIdentity,
  deskSchema,
  markerSchema,
  MAX_DESKS,
  msSchema,
  nameSchema,
  phaseSchema,
  playerStateSchema,
  raceInfoSchema,
  raceRoleSchema,
  resumeKeySchema,
  textOverlaySchema,
} from "./race";
import { roomCodeSchema } from "./room-code";
import { raceSettingsPatchSchema, raceSettingsSchema } from "./settings";
import { versionSchema } from "./version";

/** Socket.IO handshake `auth` payload; `resumeKey` reclaims a desk after a line cut (ARCHITECTURE 7.4). */
export const handshakeAuthSchema = z.object({
  v: versionSchema,
  token: z.string().min(1).max(4096),
  resumeKey: resumeKeySchema.optional(),
});
export type HandshakeAuth = z.infer<typeof handshakeAuthSchema>;

/**
 * Sent as the Socket.IO `connect_error` message when the handshake is refused. `in-progress`: the
 * room is past `waiting` and the client has no resume key.
 */
export const rejectReasonSchema = z.enum([
  "version",
  "bad-token",
  "no-room",
  "closed",
  "in-progress",
]);
export type RejectReason = z.infer<typeof rejectReasonSchema>;

/** A desk's occupant. `color`/`marker` always equal `deskIdentity(desk)`. */
export const memberSchema = z
  .object({
    desk: deskSchema,
    name: nameSchema,
    isHost: z.boolean(),
    isBot: z.boolean(),
    color: z
      .int()
      .min(0)
      .max(DESK_COLORS - 1),
    marker: markerSchema,
  })
  .refine((m) => {
    const id = deskIdentity(m.desk);
    return id.color === m.color && id.marker === m.marker;
  }, "color and marker are deskIdentity(desk)");
export type Member = z.infer<typeof memberSchema>;

const membersSchema = z.array(memberSchema).max(MAX_DESKS);

/**
 * First event after a successful handshake (and after a resume): who you are, the room, everyone in
 * it, the settings, and, once a race exists, the race, your authoritative state and overlay.
 */
export const welcomeSchema = z.object({
  v: versionSchema,
  role: raceRoleSchema,
  /** `null` for a spectator. */
  you: deskSchema.nullable(),
  room: z.object({ code: roomCodeSchema, phase: phaseSchema }),
  members: membersSchema,
  settings: raceSettingsSchema,
  race: raceInfoSchema.nullable(),
  state: playerStateSchema.nullable(),
  overlay: textOverlaySchema.nullable(),
  resumeKey: resumeKeySchema.nullable(),
  /** Server clock (ms epoch) when sent: the client's first clock offset. */
  serverNow: msSchema,
});
export type Welcome = z.infer<typeof welcomeSchema>;

/** Broadcast whenever the room's membership changes. */
export const rosterSchema = z.object({
  v: versionSchema,
  members: membersSchema,
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
  countdown: countdownSchema,
  snapshot: snapshotSchema,
  event: eventSchema,
  ended: endedSchema,
  rejected: rejectedSchema,
  pong: pongSchema,
} as const;

/** Client -> server event map. A later event is one schema here, plus its ack in `clientAcks` if any. */
export const clientEvents = {
  "host:settings": hostSettingsSchema,
  "host:start": hostStartSchema,
  keys: keysSchema,
  abandon: abandonSchema,
  "bonus:play": bonusPlaySchema,
  ping: pingSchema,
} as const;

/** Acknowledgement schema of the client events that have one; the others are refused by `rejected`. */
export const clientAcks = {
  "host:settings": hostSettingsAckSchema,
  "host:start": hostStartAckSchema,
} as const satisfies Partial<Record<keyof typeof clientEvents, z.ZodType>>;

/** Typed Socket.IO generics: `Server<ClientToServerEvents, ServerToClientEvents>`. */
export type ServerToClientEvents = {
  [K in keyof typeof serverEvents]: (payload: z.infer<(typeof serverEvents)[K]>) => void;
};
export type ClientToServerEvents = {
  [K in keyof typeof clientEvents]: K extends keyof typeof clientAcks
    ? (
        payload: z.infer<(typeof clientEvents)[K]>,
        ack: (a: z.infer<(typeof clientAcks)[K]>) => void,
      ) => void
    : (payload: z.infer<(typeof clientEvents)[K]>) => void;
};
