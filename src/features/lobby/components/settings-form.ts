import {
  raceSettingsPatchSchema,
  raceSettingsSchema,
  type BotLevel,
  type Difficulty,
  type RaceSettings,
  type RaceSettingsPatch,
} from "@fifth-copy/protocol";
import type { HostSettingsResult } from "@/features/race";
import type { SetLobbyTypeResult } from "../types";

/**
 * The host's settings form (#110, spec 8), pure: which rows the host edits, the one place a control
 * becomes a one-field `host:settings` patch, its validation and the form's state. No rule lives here
 * (ADR 0007): validity is `raceSettingsPatchSchema`, the bounds are read from `raceSettingsSchema`.
 */

/** The custom recipe's fields, each a row of its own under DIFFICULTY while the level is `custom`. */
export type RecipeField = "wordLength" | "rareLetters" | "punctuationDensity";

/** One bot's sub-row under BOTS (#114), 1-based in desk order: `bots.1` is the first bot. */
export type BotKey = `bots.${number}`;

/**
 * A row the host edits: every setting, plus the recipe rows and one sub-row per bot (#114). `bots` is
 * the BOTS row itself (its control adds a bot); `lobbyType` is the LOBBY row, written by the web action
 * `setLobbyType` (Postgres owns `Lobby.type`, ADR 0008), never by a `host:settings` patch.
 */
export type FormKey = keyof RaceSettings | `difficulty.${RecipeField}` | BotKey;

/** The lobby's visibility as the docket and the action name it. */
export type LobbyKind = RaceSettings["lobbyType"];
export const LOBBY_KINDS = raceSettingsSchema.shape.lobbyType.options;

/** A new bot files at Clerk, the lowest level that beats a learner (bible 14.3, #114). */
export const NEW_BOT_LEVEL: BotLevel = "clerk";

/** What a control hands over: a segment's option, a toggle's boolean, an input's text, or `null` (NO TIMER). */
export type RawValue = string | boolean | null;

const shape = raceSettingsSchema.shape;
const timerShape = shape.timerS.unwrap();

/** The schema's own limit on practice letters, read from the issue it raises for too long a list. */
function lettersMax(): number {
  const tooMany = Array.from({ length: 1000 }, () => "a");
  const issue = shape.practiceLetters
    .safeParse(tooMany)
    .error?.issues.find((i) => i.code === "too_big");
  return issue && "maximum" in issue ? Number(issue.maximum) : 0;
}

/** The inputs' bounds, from the schema (`min`/`max` attributes and the error copy). */
export const BOUNDS = {
  words: { min: shape.wordCount.minValue ?? 0, max: shape.wordCount.maxValue ?? 0 },
  minutes: { min: (timerShape.minValue ?? 0) / 60, max: (timerShape.maxValue ?? 0) / 60 },
  letters: { max: lettersMax() },
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
  rows.push("bonuses", "bots");
  settings.bots.forEach((_, i) => rows.push(`bots.${i + 1}`));
  rows.push("lobbyType");
  return rows;
}

/** The 0-based index of a bot sub-row key, or -1 for any other key. */
export const botIndex = (key: FormKey): number =>
  /^bots\.\d+$/.test(key) ? Number(key.slice("bots.".length)) - 1 : -1;

/** A whole number as typed, or NaN (the schema refuses it): `"1e2"` or `"0x32"` never pass as numbers. */
const wholeNumber = (raw: RawValue) =>
  typeof raw === "string" && /^\s*\d+\s*$/.test(raw) ? Number(raw) : Number.NaN;

/** The letters as typed: whitespace dropped, one entry per code point, never normalised (#583). */
const letters = (raw: RawValue) => Array.from(String(raw ?? "").replace(/\s+/gu, ""));

function botsPatch(key: FormKey, raw: RawValue, current: RaceSettings): RaceSettingsPatch | null {
  // ADD A BOT: one more at the new bot level; the schema caps the count (MAX_BOTS)
  if (key === "bots") return { bots: [...current.bots, { level: NEW_BOT_LEVEL }] };
  const at = botIndex(key);
  if (at < 0 || at >= current.bots.length) return null;
  // REMOVE (`null`) drops the bot; a level replaces its level; the whole array is sent either way
  const bots =
    raw === null
      ? current.bots.filter((_, i) => i !== at)
      : current.bots.map((b, i) => (i === at ? { level: raw as BotLevel } : b));
  return { bots };
}

function patchOf(key: FormKey, raw: RawValue, current: RaceSettings): RaceSettingsPatch | null {
  if (key === "lobbyType") return null; // the web action's, never a room patch (ADR 0008)
  if (key === "bots" || key.startsWith("bots.")) return botsPatch(key, raw, current);
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
 * The one place a control becomes a patch: one field, or `null` when the value would not change (a
 * pressed segment, an input left as it was, CUSTOM while custom). A bot row rebuilds the whole `bots`
 * array (#114). Unvalidated.
 */
export function buildPatch(
  key: FormKey,
  raw: RawValue,
  current: RaceSettings,
): RaceSettingsPatch | null {
  if (key === "difficulty" && raw === "custom" && current.difficulty.level === "custom")
    return null;
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

/** An answer to a change: the room's ack, or `setLobbyType`'s mapped onto it (#114). */
export type FormAck = { ok: true } | Extract<HostSettingsResult, { ok: false }>;

export type FormEvent =
  | { type: "submit"; key: FormKey }
  | { type: "refuse"; key: FormKey; error: LocalError }
  | { type: "ack"; result: FormAck };

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
      // Over the room's budget (#750): the "did not answer, try again" line, no new copy.
      if (event.result.error === "rate-limited") {
        return { status: "error", key: state.key, error: "timeout" };
      }
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

/** The `setLobbyType` refusals as the form's own (one error line, no new copy). */
function lobbyAck(result: SetLobbyTypeResult): FormAck {
  if (result.ok) return { ok: true };
  switch (result.error) {
    case "not-host":
      return { ok: false, error: "not-host" };
    case "closed":
      return { ok: false, error: "not-waiting" };
    case "not-found":
      return { ok: false, error: "no-room" };
    case "rate-limited":
    // the race server did not answer (#815): nothing was filed, the host retries
    case "unavailable":
      return { ok: false, error: "timeout" };
    default:
      return { ok: false, error: "invalid" };
  }
}

/**
 * The host pressed PUBLIC or PRIVATE (#114 C3): the same form state as a room patch (one change at a
 * time, pending until the answer, one error line), but sent to the web action `setLobbyType`; on `ok`
 * the action's revalidation brings the new `Lobby.type` back as the page's prop.
 */
export async function submitLobbyType(
  ctx: {
    form: FormState;
    current: LobbyKind;
    send: (type: LobbyKind) => Promise<SetLobbyTypeResult>;
    dispatch: (event: FormEvent) => void;
  },
  raw: RawValue,
): Promise<void> {
  if (ctx.form.status === "pending" || ctx.form.status === "hidden") return;
  if (raw === ctx.current) return;
  const type = LOBBY_KINDS.find((k) => k === raw);
  if (!type) return ctx.dispatch({ type: "refuse", key: "lobbyType", error: "invalid" });
  ctx.dispatch({ type: "submit", key: "lobbyType" });
  ctx.dispatch({ type: "ack", result: lobbyAck(await ctx.send(type)) });
}
