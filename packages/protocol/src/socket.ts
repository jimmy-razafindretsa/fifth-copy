import { z } from "zod";
import {
  abandonSchema,
  bonusPlaySchema,
  autoStartSchema,
  countdownSchema,
  endedSchema,
  eventSchema,
  hostStartAckSchema,
  hostStartSchema,
  keysSchema,
  loadingSchema,
  pendingDesksSchema,
  pingSchema,
  readinessSchema,
  readySchema,
  pongSchema,
  rejectedSchema,
  snapshotSchema,
} from "./events";
import {
  DESK_COLORS,
  deskIdentity,
  avatarVersionSchema,
  bonusKindSchema,
  deskSchema,
  idSchema,
  markerSchema,
  MAX_DESKS,
  msSchema,
  nameSchema,
  phaseSchema,
  playerStateSchema,
  raceInfoSchema,
  raceMsSchema,
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
 * room is past `waiting` and the client has no resume key. `room-full`: a spectator handshake past the
 * room's spectator cap (#616); seated players are never refused with it. `removed` (#133): the host
 * removed this user from this room (`host:kick`); every later handshake of the user for the room,
 * player or spectator, is refused with it while the room lives.
 */
export const rejectReasonSchema = z.enum([
  "version",
  "bad-token",
  "no-room",
  "closed",
  "in-progress",
  "room-full",
  "removed",
]);
export type RejectReason = z.infer<typeof rejectReasonSchema>;

/**
 * What the roll needs to draw a member's portrait (#730): the user and the version of its approved
 * avatar, addressed as `/api/avatars/<userId>?size=64&v=<v>`. Only members with an approved avatar
 * carry one, and the route still serves it only to lobby mates (ADR 0014, 0022).
 */
export const memberAvatarSchema = z.object({ userId: idSchema, v: avatarVersionSchema });
export type MemberAvatar = z.infer<typeof memberAvatarSchema>;

/**
 * A desk's occupant. `color`/`marker` always equal `deskIdentity(desk)`. `avatar` is null for bots
 * and for members without an approved avatar (#730).
 */
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
    avatar: memberAvatarSchema.nullable(),
  })
  .refine((m) => {
    const id = deskIdentity(m.desk);
    return id.color === m.color && id.marker === m.marker;
  }, "color and marker are deskIdentity(desk)")
  .refine((m) => !m.isBot || m.avatar === null, "bots have no avatar");
export type Member = z.infer<typeof memberSchema>;

const membersSchema = z.array(memberSchema).max(MAX_DESKS);

/**
 * First event after a successful handshake (and after a resume): who you are, the room, everyone in
 * it, the settings, and, once a race exists, the race, your authoritative state and overlay.
 */
/**
 * Your desk's bonus as the server holds it (#768, ADR 0016), sent in `welcome` while its race runs so
 * a reconnect gets it back: the card you hold, when your cooldown ends and when a Smoke Break's blur
 * on you lifts, both in ms since GO; each `null` when there is none (or it is over).
 */
export const welcomeBonusSchema = z.object({
  card: bonusKindSchema.nullable(),
  cooldownUntil: raceMsSchema.nullable(),
  blurUntil: raceMsSchema.nullable(),
});
export type WelcomeBonus = z.infer<typeof welcomeBonusSchema>;

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
  /** `null` outside a running race and for a spectator (#768). */
  bonus: welcomeBonusSchema.nullable(),
  resumeKey: resumeKeySchema.nullable(),
  /** Server clock (ms epoch) when sent: the client's first clock offset. */
  serverNow: msSchema,
  /** The room's pending automatic start (#814, server ms epoch), else `null`. */
  autoStartAt: msSchema.nullable(),
  /** The desks the readiness barrier still awaits while the room is `loading` (#926), else `null`. */
  pending: pendingDesksSchema.nullable(),
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

/**
 * Acknowledgement of `host:settings`: the settings after the change, or why nothing changed.
 * `rate-limited` is answered by the race server's guard when the call is over the identity's
 * budget (#750), so the host's form shows it at once instead of waiting out its timeout. `room-full`:
 * a watching host's switch back to typing finds the 30 desks seated (#876), nothing changed.
 */
export const hostSettingsAckSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), settings: raceSettingsSchema }),
  z.object({
    ok: z.literal(false),
    error: z.enum(["not-host", "not-waiting", "invalid", "no-room", "rate-limited", "room-full"]),
  }),
]);
export type HostSettingsAck = z.infer<typeof hostSettingsAckSchema>;

/**
 * Client -> server, host only, `waiting` or `ended` only (#133, ARCHITECTURE 7.1): remove the human
 * at `desk` from the room. The removed user's sockets get `event { kind: "kicked", desk }` (as the
 * whole room does) and are disconnected; the user is refused `removed` from then on. Strict: the
 * payload names a desk, never a user.
 */
export const hostKickSchema = z.strictObject({
  v: versionSchema,
  desk: deskSchema,
});
export type HostKick = z.infer<typeof hostKickSchema>;

/**
 * Acknowledgement of `host:kick`. `not-host`: the sender is not the room's host. `not-waiting`: the
 * room is in a race (countdown, running) or gone. `no-such-desk`: nobody sits at `desk`. `is-bot`:
 * bots leave through the bots setting (#114). `self`: the host's own desk.
 */
export const hostKickAckSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    error: z.enum(["not-host", "not-waiting", "no-such-desk", "is-bot", "self"]),
  }),
]);
export type HostKickAck = z.infer<typeof hostKickAckSchema>;

/** Server -> client event map. A later event is one schema plus one key here. */
export const serverEvents = {
  welcome: welcomeSchema,
  roster: rosterSchema,
  settings: settingsSchema,
  loading: loadingSchema,
  readiness: readinessSchema,
  countdown: countdownSchema,
  "auto-start": autoStartSchema,
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
  "host:kick": hostKickSchema,
  keys: keysSchema,
  abandon: abandonSchema,
  "bonus:play": bonusPlaySchema,
  ready: readySchema,
  ping: pingSchema,
} as const;

/** Acknowledgement schema of the client events that have one; the others are refused by `rejected`. */
export const clientAcks = {
  "host:settings": hostSettingsAckSchema,
  "host:start": hostStartAckSchema,
  "host:kick": hostKickAckSchema,
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
