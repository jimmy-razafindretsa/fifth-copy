import { type EngineSettings, type ErrorMode, isTypeable } from "@fifth-copy/engine";
import { z } from "zod";

/**
 * Host race settings (spec 8): the one schema, its defaults and helpers. Stored in the race server's
 * room hash (ADR 0008), sent in `welcome` and `POST /internal/rooms`, patched by `host:settings`.
 * Later cards add fields here; they never rename one.
 */

/** Language of the race text; independent of the UI locale (R190). */
export const raceLanguageSchema = z.enum(["fr", "en"]);
export type RaceLanguage = z.infer<typeof raceLanguageSchema>;

export const textTypeSchema = z.enum(["sentences", "words", "special-characters"]);
export type TextType = z.infer<typeof textTypeSchema>;

/** A preset level, or a custom recipe for the text generator. */
export const difficultySchema = z.discriminatedUnion("level", [
  z.strictObject({ level: z.enum(["easy", "normal", "hard"]) }),
  z.strictObject({
    level: z.literal("custom"),
    wordLength: z.enum(["short", "medium", "long"]),
    rareLetters: z.boolean(),
    punctuationDensity: z.enum(["none", "light", "heavy"]),
  }),
]);
export type Difficulty = z.infer<typeof difficultySchema>;

export const botLevelSchema = z.enum(["recruit", "clerk", "officer", "commissar", "major"]);
export type BotLevel = z.infer<typeof botLevelSchema>;

/** Target typing speed of each bot level (spec 9). */
export const BOT_LEVEL_WPM: Record<BotLevel, number> = {
  recruit: 20,
  clerk: 35,
  officer: 50,
  commissar: 70,
  major: 90,
};

/** 30 desks in the waiting-room ring, one for the host. */
export const MAX_BOTS = 29;

/** The engine owns the error modes (ADR 0007); this only mirrors its type for parsing. */
const errorModeSchema = z.enum(["continue", "block"]) satisfies z.ZodType<ErrorMode>;

/**
 * One typeable letter: a member of the engine's whitelist (`isTypeable`, #157: one NFC code point,
 * never control, format, zero-width or emoji; NFD input is rejected, not normalised) that is also a
 * Unicode letter (no space, digit, punctuation or symbol).
 */
const practiceLetterSchema = z
  .string()
  .refine((s) => isTypeable(s) && /^\p{L}$/u.test(s), "one typeable letter");

export const raceSettingsSchema = z.strictObject({
  language: raceLanguageSchema,
  textType: textTypeSchema,
  wordCount: z.int().min(10).max(500),
  accentEveryWord: z.boolean(),
  difficulty: difficultySchema,
  practiceLetters: z
    .array(practiceLetterSchema)
    .max(12)
    .refine((xs) => new Set(xs).size === xs.length, "distinct letters"),
  includeNumbers: z.boolean(),
  includeSymbols: z.boolean(),
  includePunctuation: z.boolean(),
  timerS: z.int().min(60).max(600).nullable(),
  errorMode: errorModeSchema,
  backspace: z.boolean(),
  bonuses: z.boolean(),
  bots: z.array(z.strictObject({ level: botLevelSchema })).max(MAX_BOTS),
  lobbyType: z.enum(["public", "private"]),
});
export type RaceSettings = z.infer<typeof raceSettingsSchema>;

export const DEFAULT_RACE_SETTINGS: RaceSettings = {
  language: "en",
  textType: "sentences",
  wordCount: 50,
  accentEveryWord: false,
  difficulty: { level: "normal" },
  practiceLetters: [],
  includeNumbers: false,
  includeSymbols: false,
  includePunctuation: true,
  timerS: null,
  errorMode: "continue",
  backspace: true,
  bonuses: true,
  bots: [],
  lobbyType: "private",
};

/** What `host:settings` may change. `lobbyType` is excluded: `Lobby.type` is Postgres-owned. */
export const raceSettingsPatchSchema = raceSettingsSchema.omit({ lobbyType: true }).partial();
export type RaceSettingsPatch = z.infer<typeof raceSettingsPatchSchema>;

/** Merges a partial over the defaults and parses the result; throws on invalid input. */
export function withDefaults(partial: Partial<RaceSettings>): RaceSettings {
  return raceSettingsSchema.parse({ ...DEFAULT_RACE_SETTINGS, ...partial });
}

/** The engine's subset. `backspace` only matters in `continue` mode (an engine rule, not checked here). */
export function engineSettingsOf(settings: RaceSettings): EngineSettings {
  return { errorMode: settings.errorMode, backspace: settings.backspace };
}
