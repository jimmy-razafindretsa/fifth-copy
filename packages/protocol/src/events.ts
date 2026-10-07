import { z } from "zod";
import {
  bonusKindSchema,
  deskSchema,
  endReasonSchema,
  keystrokeSchema,
  MAX_DESKS,
  msSchema,
  PLAYER_STATUSES,
  raceIdSchema,
  raceInfoSchema,
  rankingEntrySchema,
  textOverlaySchema,
} from "./race";
import { versionSchema } from "./version";

/**
 * Live race messages (ADR 0006 point 4, ARCHITECTURE 7.2-7.8). Declared here, handled by the race
 * server cards (#166 start, #173 keys/snapshots, #178 resume, #183 idle, #187 spectators, #190
 * bonuses). The maps that type Socket.IO live in `socket.ts`.
 */

/* ---------- server -> client ---------- */

/** Host pressed start: the text and the GO instant (`race.t0`, server ms epoch). */
export const countdownSchema = z.object({ v: versionSchema, race: raceInfoSchema });
export type Countdown = z.infer<typeof countdownSchema>;

/** One desk in a snapshot: `[desk, cursor, correct, errors, statusCode]` (`PLAYER_STATUSES[code]`). */
const count = z.int().min(0);
export const snapshotDeskSchema = z.tuple([
  deskSchema,
  count,
  count,
  count,
  z
    .int()
    .min(0)
    .max(PLAYER_STATUSES.length - 1),
]);

/** 10 Hz full state of every desk (compact tuples, ARCHITECTURE 7.9); `t` is ms since GO. */
export const snapshotSchema = z.object({
  v: versionSchema,
  t: msSchema,
  desks: z.array(snapshotDeskSchema).max(MAX_DESKS),
  ranks: z.array(deskSchema).max(MAX_DESKS),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

function ev<K extends string, S extends z.ZodRawShape>(kind: K, shape: S) {
  return z.object({ v: versionSchema, kind: z.literal(kind), ...shape });
}
const desk = deskSchema;

/** Discrete race happenings, one `kind` each. Extension point: add a member, never rename one. */
export const eventSchema = z.discriminatedUnion("kind", [
  ev("finished", { desk, place: deskSchema }),
  ev("overtake", { desk, passed: deskSchema }),
  ev("passed", { desk, by: deskSchema }),
  ev("new-leader", { desk }),
  ev("new-host", { desk }),
  ev("line-cut", { desk }),
  ev("resumed", { desk }),
  /** `kickAt`: ms since GO when the idle desk is put to sleep. */
  ev("idle-warning", { desk, kickAt: msSchema }),
  ev("asleep", { desk }),
  ev("abandoned", { desk }),
  ev("kicked", { desk }),
  ev("bonus-earned", { desk, bonus: bonusKindSchema }),
  ev("bonus-sent", {
    from: deskSchema,
    to: z.array(deskSchema).min(1).max(MAX_DESKS),
    bonus: bonusKindSchema,
  }),
  /** `overlay`: the target's full overlay after the hit; `blurUntil`: ms since GO, smoke break only. */
  ev("bonus-hit", {
    desk,
    bonus: bonusKindSchema,
    overlay: textOverlaySchema.nullable(),
    blurUntil: msSchema.nullable(),
  }),
]);
export type RaceEvent = z.infer<typeof eventSchema>;
export type RaceEventKind = RaceEvent["kind"];

/** The race is over (or void); `ranking` is final and ordered by place. */
export const endedSchema = z.object({
  v: versionSchema,
  raceId: raceIdSchema,
  reason: endReasonSchema,
  ranking: z.array(rankingEntrySchema).max(MAX_DESKS),
});
export type Ended = z.infer<typeof endedSchema>;

/** Unsolicited refusal of `keys`, `abandon` or `bonus:play` (those events carry no ack). */
export const rejectedReasonSchema = z.enum([
  "before-go",
  "not-running",
  "spectator",
  "rate-limit",
  "no-bonus",
]);
export const rejectedSchema = z.object({ v: versionSchema, reason: rejectedReasonSchema });
export type Rejected = z.infer<typeof rejectedSchema>;

/** Answer to `ping`: echoes `sent`, adds the server clock (ms epoch) for the offset (#172). */
export const pongSchema = z.object({ v: versionSchema, sent: msSchema, serverNow: msSchema });
export type Pong = z.infer<typeof pongSchema>;

/* ---------- client -> server ---------- */

/** Host only, waiting phase only; answered by `hostStartAckSchema` through the Socket.IO ack. */
export const hostStartSchema = z.object({ v: versionSchema });
export type HostStart = z.infer<typeof hostStartSchema>;

export const hostStartAckSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), raceId: raceIdSchema }),
  z.object({
    ok: z.literal(false),
    error: z.enum(["not-host", "too-few", "not-waiting", "start-failed"]),
  }),
]);
export type HostStartAck = z.infer<typeof hostStartAckSchema>;

/** <= 50 ms of keys per batch on the client; the wire accepts up to 64. */
export const MAX_KEYS_PER_BATCH = 64;

/** Keystrokes in sending order; `t` need not be monotonic (the server clamps, #173). */
export const keysSchema = z.object({
  v: versionSchema,
  batch: z.array(keystrokeSchema).min(1).max(MAX_KEYS_PER_BATCH),
});
export type Keys = z.infer<typeof keysSchema>;

export const abandonSchema = z.object({ v: versionSchema });
export const bonusPlaySchema = z.object({ v: versionSchema });

/** `sent`: the client's own clock (ms), echoed by `pong`. */
export const pingSchema = z.object({ v: versionSchema, sent: msSchema });
export type Ping = z.infer<typeof pingSchema>;
