import { BACKSPACE, type Keystroke, type PlayerState, type PlayerStatus } from "@fifth-copy/engine";
import { z } from "zod";
import { raceLanguageSchema, raceSettingsSchema } from "./settings";

/**
 * Race-domain value schemas shared by the socket events (`events.ts`, `socket.ts`) and the internal
 * payloads (`internal.ts`). Engine types are mirrored, never redefined (ADR 0007). Every string and
 * array is bounded: these are parsed at a public edge.
 */

/** Desks per race (spec 7: 100 players supported, no hard maximum below this). */
export const MAX_DESKS = 256;
/** Display names (members, rankings, token claims). */
export const MAX_NAME_LENGTH = 64;
/** Race text in UTF-16 units (500 words at most, generous per-word allowance). */
export const MAX_TEXT_LENGTH = 20_000;
/** Words in a text and in an overlay; the bound of `wordCount`, `extra` and `removed`. */
export const MAX_OVERLAY_WORDS = 500;
/** Opaque ids (users, lobbies) as minted by the web app. */
export const MAX_ID_LENGTH = 128;

export const deskSchema = z.int().min(1).max(MAX_DESKS);
export const nameSchema = z.string().min(1).max(MAX_NAME_LENGTH);
export const idSchema = z.string().min(1).max(MAX_ID_LENGTH);
/** Chosen by the race server (uuid v4) so `POST /api/internal/races` is idempotent. */
export const raceIdSchema = z.uuidv4();
/** Milliseconds: a server epoch or a duration since GO. Never negative. */
export const msSchema = z.int().min(0);

/** Race token role (ADR 0009); also `welcome.role`. A spectator has no desk. */
export const raceRoleSchema = z.enum(["host", "player", "spectator"]);
export type RaceRole = z.infer<typeof raceRoleSchema>;

export const phaseSchema = z.enum(["waiting", "countdown", "running", "ended"]);
export type Phase = z.infer<typeof phaseSchema>;

/** Engine `PlayerStatus` in engine order; the index is the snapshot status code. */
export const PLAYER_STATUSES = [
  "typing",
  "finished",
  "abandoned",
  "asleep",
  "line-cut",
  "expired",
] as const satisfies readonly PlayerStatus[];
// Compile-time guard: an engine status missing here fails the build.
const _everyStatus: Exclude<PlayerStatus, (typeof PLAYER_STATUSES)[number]> extends never
  ? true
  : never = true;
void _everyStatus;

export const playerStatusSchema = z.enum(PLAYER_STATUSES) satisfies z.ZodType<PlayerStatus>;

/** Status -> snapshot code; `PLAYER_STATUSES[code]` is the reverse. */
export const PLAYER_STATUS_CODES = Object.fromEntries(
  PLAYER_STATUSES.map((status, code) => [status, code]),
) as Record<PlayerStatus, number>;

export const MARKERS = ["circle", "square", "triangle", "diamond"] as const;
export const markerSchema = z.enum(MARKERS);
export type Marker = z.infer<typeof markerSchema>;
export const DESK_COLORS = 12;

/** A desk's placard colour and marker: a pure function, so server and client agree without a message. */
export function deskIdentity(desk: number): { color: number; marker: Marker } {
  return {
    color: (desk - 1) % DESK_COLORS,
    marker: MARKERS[Math.floor((desk - 1) / DESK_COLORS) % MARKERS.length]!,
  };
}

/** Handshake resume key (ARCHITECTURE 7.4): opaque, URL-safe, 32..64 characters. */
export const resumeKeySchema = z
  .string()
  .min(32)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

/** "Backspace" or exactly one code point (a modifier name such as "Shift" never crosses the wire). */
const keySchema = z
  .string()
  .min(1)
  .max(16)
  .refine((key) => key === BACKSPACE || [...key].length === 1, "one character or Backspace");

/** Engine `Keystroke`: `t` is ms since GO on the sender's clock (ARCHITECTURE 7.3). */
export const keystrokeSchema = z.object({
  t: msSchema,
  key: keySchema,
}) satisfies z.ZodType<Keystroke>;

const wordSchema = z.string().min(1).max(64);

/** Bonus effects on the base text (ADR 0007): words appended, indexes of base words removed. */
export const textOverlaySchema = z.object({
  extra: z.array(wordSchema).max(MAX_OVERLAY_WORDS),
  removed: z.array(z.int().min(0)).max(MAX_OVERLAY_WORDS),
});
export type TextOverlay = z.infer<typeof textOverlaySchema>;

export const bonusKindSchema = z.enum(["extra-paperwork", "exemption", "smoke-break"]);
export type BonusKind = z.infer<typeof bonusKindSchema>;

export const raceTextSchema = z.string().min(1).max(MAX_TEXT_LENGTH);
export const wordCountSchema = z.int().min(1).max(MAX_OVERLAY_WORDS);

/** What every client needs to render a race: the text and the GO instant (server ms epoch). */
export const raceInfoSchema = z.object({
  raceId: raceIdSchema,
  text: raceTextSchema,
  language: raceLanguageSchema,
  wordCount: wordCountSchema,
  t0: msSchema,
  timerS: raceSettingsSchema.shape.timerS,
});
export type RaceInfo = z.infer<typeof raceInfoSchema>;

/** Engine `PlayerState`: the viewer's authoritative state, sent in `welcome` while running. */
export const playerStateSchema = z.object({
  cursor: z.int().min(0),
  correct: z.int().min(0),
  errors: z.int().min(0),
  total: z.int().min(0),
  typed: z.array(keySchema.nullable()).max(MAX_TEXT_LENGTH),
  status: playerStatusSchema,
  lastT: msSchema,
  finishedAt: msSchema.nullable(),
}) satisfies z.ZodType<PlayerState>;

export const ratioSchema = z.number().min(0).max(1);
export const wpmSchema = z.number().min(0);

/** One line of the final ranking (`ended`). */
export const rankingEntrySchema = z.object({
  place: deskSchema,
  desk: deskSchema,
  name: nameSchema,
  isBot: z.boolean(),
  status: playerStatusSchema,
  wpm: wpmSchema,
  rawWpm: wpmSchema,
  accuracy: ratioSchema,
  progress: ratioSchema,
  finishedAt: msSchema.nullable(),
});
export type RankingEntry = z.infer<typeof rankingEntrySchema>;

/** `void`: the race was annulled (#204); a void race is never sent to the results route. */
export const endReasonSchema = z.enum(["all-finished", "timer", "void"]);
export type EndReason = z.infer<typeof endReasonSchema>;

