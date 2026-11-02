import {
  raceSettingsPatchSchema,
  raceSettingsSchema,
  type Difficulty,
  type RaceSettings,
  type RaceSettingsPatch,
} from "@fifth-copy/protocol";
import type { HostSettingsResult } from "@/features/race";

/**
 * The host's settings form (#110, spec 8), pure: which rows the host edits, the one place a control
 * becomes a one-field `host:settings` patch, its validation and the form's state. No rule lives here
 * (ADR 0007): validity is `raceSettingsPatchSchema`, the bounds are read from `raceSettingsSchema`.
 */

/** The custom recipe's fields, each a row of its own under DIFFICULTY while the level is `custom`. */
export type RecipeField = "wordLength" | "rareLetters" | "punctuationDensity";

/** A row the host edits: every setting but `bots` and `lobbyType` (#114), plus the recipe rows. */
export type FormKey =
  | Exclude<keyof RaceSettings, "bots" | "lobbyType">
  | `difficulty.${RecipeField}`;

/** What a control hands over: a segment's option, a toggle's boolean, an input's text, or `null` (NO TIMER). */
export type RawValue = string | boolean | null;

const shape = raceSettingsSchema.shape;
const timerShape = shape.timerS.unwrap();

/** The numeric inputs' bounds, from the schema (`min`/`max` attributes and the error copy). */
export const BOUNDS = {
  words: { min: shape.wordCount.minValue ?? 0, max: shape.wordCount.maxValue ?? 0 },
  minutes: { min: (timerShape.minValue ?? 0) / 60, max: (timerShape.maxValue ?? 0) / 60 },
} as const;

/** CUSTOM starts from NORMAL's middle values (bible 14.3, #110). */
export const CUSTOM_START: Extract<Difficulty, { level: "custom" }> = {
  level: "custom",
  wordLength: "medium",
  rareLetters: false,
  punctuationDensity: "light",
};

const RECIPE_ROWS: ReadonlyArray<FormKey> = [
  "difficulty.wordLength",
  "difficulty.rareLetters",
  "difficulty.punctuationDensity",
];

/**
 * The rows the host edits for these settings, in the docket's order (spec 8): the accents row only in
 * French, the recipe rows right under DIFFICULTY only while custom, the backspace row only in continue
 * mode (the docket's own `when` rules, #498).
 */
export function hostRows(settings: RaceSettings): FormKey[] {
  const rows: FormKey[] = ["language", "textType", "wordCount"];
  if (settings.language === "fr") rows.push("accentEveryWord");
  rows.push("difficulty");
  if (settings.difficulty.level === "custom") rows.push(...RECIPE_ROWS);
  rows.push("practiceLetters", "includeNumbers", "includeSymbols", "includePunctuation", "timerS");
  rows.push("errorMode");
  if (settings.errorMode === "continue") rows.push("backspace");
  rows.push("bonuses");
  return rows;
}

/** A whole number as typed, or NaN (the schema refuses it): `"1e2"` or `"0x32"` never pass as numbers. */
const wholeNumber = (raw: RawValue) =>
  typeof raw === "string" && /^\s*\d+\s*$/.test(raw) ? Number(raw) : Number.NaN;

/** The letters as typed: whitespace dropped, one entry per code point, never normalised (#583). */
const letters = (raw: RawValue) => Array.from(String(raw ?? "").replace(/\s+/gu, ""));

function patchOf(key: FormKey, raw: RawValue, current: RaceSettings): RaceSettingsPatch | null {
  switch (key) {
    case "wordCount":
      return { wordCount: wholeNumber(raw) };
    case "timerS":
      return { timerS: raw === null ? null : wholeNumber(raw) * 60 };
    case "practiceLetters":
      return { practiceLetters: letters(raw) };
    case "difficulty":
      return raw === "custom"
        ? { difficulty: CUSTOM_START }
        : { difficulty: { level: raw } as Difficulty };
    case "difficulty.wordLength":
    case "difficulty.rareLetters":
    case "difficulty.punctuationDensity": {
      if (current.difficulty.level !== "custom") return null;
      const field = key.slice("difficulty.".length) as RecipeField;
      return { difficulty: { ...current.difficulty, [field]: raw } as Difficulty };
    }
    default:
      return { [key]: raw } as RaceSettingsPatch;
  }
}

/**
 * The one place a control becomes a patch (#114 adds `bots` here): one field, or `null` when the value
 * would not change (a pressed segment, an input left as it was, CUSTOM while custom). Unvalidated.
 */
export function buildPatch(
  key: FormKey,
  raw: RawValue,
  current: RaceSettings,
): RaceSettingsPatch | null {
  if (key === "difficulty" && raw === "custom" && current.difficulty.level === "custom") return null;
  const patch = patchOf(key, raw, current);
  if (!patch) return null;
  const [field, value] = Object.entries(patch)[0]!;
  const was = current[field as keyof RaceSettings];
  // objects (a recipe, the letters) by content; numbers by identity, so NaN (refused later) is a change
  const same =
    typeof value === "object" && value !== null
      ? JSON.stringify(value) === JSON.stringify(was)
      : Object.is(value, was);
  return same ? null : patch;
}

/** Why the page refused a change itself: never the typed text (C4). */
export type LocalError = "words" | "timer" | "too-many-letters" | "letters" | "invalid";
/** Why the room refused one (`not-host` hides the form instead). */
export type RoomError = "not-waiting" | "invalid" | "no-room" | "timeout";
export type FormError = LocalError | RoomError;

export type Validated = { ok: true; patch: RaceSettingsPatch } | { ok: false; error: LocalError };

/** `raceSettingsPatchSchema.safeParse`, its first issue named by the field it is about. */
export function validate(patch: RaceSettingsPatch): Validated {
  const result = raceSettingsPatchSchema.safeParse(patch);
  if (result.success) return { ok: true, patch: result.data };
  const issue = result.error.issues[0];
  switch (issue?.path[0]) {
    case "wordCount":
      return { ok: false, error: "words" };
    case "timerS":
      return { ok: false, error: "timer" };
    case "practiceLetters":
      return {
        ok: false,
        error: issue.code === "too_big" && issue.path.length === 1 ? "too-many-letters" : "letters",
      };
    default:
      return { ok: false, error: "invalid" };
  }
}

/** The form's state: one patch in flight at most; `hidden` after a `not-host` answer (#214's START). */
export type FormState =
  | { status: "idle" }
  | { status: "pending"; key: FormKey }
  | { status: "error"; key: FormKey; error: FormError }
  | { status: "hidden" };

export type FormEvent =
  | { type: "submit"; key: FormKey }
  | { type: "refuse"; key: FormKey; error: LocalError }
  | { type: "ack"; result: HostSettingsResult };

export const IDLE_FORM: FormState = { status: "idle" };

export function reduceForm(state: FormState, event: FormEvent): FormState {
  if (state.status === "hidden") return state;
  switch (event.type) {
    case "submit":
      return state.status === "pending" ? state : { status: "pending", key: event.key };
    case "refuse":
      return state.status === "pending"
        ? state
        : { status: "error", key: event.key, error: event.error };
    case "ack":
      if (state.status !== "pending") return state;
      // ok: the `settings` broadcast carries the new value; the control never trusts its own
      if (event.result.ok) return IDLE_FORM;
      if (event.result.error === "not-host") return { status: "hidden" };
      return { status: "error", key: state.key, error: event.result.error };
  }
}

/** The host changed one control: build, validate, then send through the room socket (C2, C4). */
export async function submitSetting(
  ctx: {
    form: FormState;
    settings: RaceSettings;
    send: (patch: RaceSettingsPatch) => Promise<HostSettingsResult>;
    dispatch: (event: FormEvent) => void;
  },
  key: FormKey,
  raw: RawValue,
): Promise<void> {
  if (ctx.form.status === "pending" || ctx.form.status === "hidden") return;
  const patch = buildPatch(key, raw, ctx.settings);
  if (!patch) return;
  const valid = validate(patch);
  if (!valid.ok) return ctx.dispatch({ type: "refuse", key, error: valid.error });
  ctx.dispatch({ type: "submit", key });
  ctx.dispatch({ type: "ack", result: await ctx.send(valid.patch) });
}
