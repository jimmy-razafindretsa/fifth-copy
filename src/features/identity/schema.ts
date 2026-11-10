import { z } from "zod";
import { ROOM_CODE_RE } from "@fifth-copy/protocol/room-code";
import { LOCALES, type Locale } from "@/i18n/locale";
import { normalizeUsername } from "@/lib/username";
import { keyboardLayoutIds, type KeyboardLayoutId } from "./keyboard/layouts";
import { OUTFIT_CATALOGUE, type OutfitCategory } from "./clerk/outfit";
import { RESET_CODE_ALPHABET, RESET_CODE_LENGTH, normalizeResetCode } from "./password-reset/code";
import { canonicalRecoveryCode } from "./recovery/generate";

// Lives in src/lib so src/server/auth can use it without importing a feature (ADR 0001).
export { normalizeUsername };

/** True when `text` holds a control character (U+0000 to U+001F); Postgres rejects NUL outright. */
const hasControlChar = (text: string) => {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 0x20) return true;
  return false;
};

/**
 * A username typed to look an account up (the rules of `verifyCredentials`, #38): at most 256
 * characters as typed and no control character (#788 C9), then `normalizeUsername`, non-empty.
 * Parses to the normalized form.
 */
export const usernameLookup = z
  .string()
  .max(256)
  .refine((raw) => !hasControlChar(raw))
  .transform(normalizeUsername)
  .pipe(z.string().min(1));

/**
 * `issuePasswordReset` input (#788): the room code the host issues from (exactly `ROOM_CODE_RE`, as
 * the host's waiting room holds it) and the student's username. Unknown keys are stripped.
 */
export const issuePasswordResetInput = z.object({
  code: z.string().regex(ROOM_CODE_RE),
  username: usernameLookup,
});

/** The square crop chosen in the dialog (#60), in displayed-image pixels; bounds are checked by storeAvatar. */
export const cropSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  size: z.number().int().positive(),
});

/** `uploadAvatar` form fields: `file` (the image) and `crop` (JSON). Any other field is ignored. */
export const uploadAvatarInput = z.object({
  file: z.instanceof(Blob),
  crop: z
    .string()
    .max(200)
    .transform((text, ctx) => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "crop is not JSON" });
        return z.NEVER;
      }
    })
    .pipe(cropSchema),
});

/** `GET /api/avatars/[userId]` query: `size` is 64 or 256, `v` the version from `avatarKey`. */
export const avatarQuery = z.object({
  size: z.enum(["64", "256"]).transform((s) => Number(s) as 64 | 256),
  v: z
    .string()
    .regex(/^[1-9][0-9]{0,15}$/)
    .transform(Number)
    .refine(Number.isSafeInteger),
});

/**
 * `saveClerkOutfit` input (bible 10.1, #687): the six slots, each an id of `OUTFIT_CATALOGUE`. Unknown keys
 * are stripped, so only the config object is ever stored.
 */
export const outfitSchema = z.object({
  hair: z.enum(OUTFIT_CATALOGUE.hair),
  glasses: z.enum(OUTFIT_CATALOGUE.glasses),
  hat: z.enum(OUTFIT_CATALOGUE.hat),
  clothes: z.enum(OUTFIT_CATALOGUE.clothes),
  face: z.enum(OUTFIT_CATALOGUE.face),
  hairCol: z.enum(OUTFIT_CATALOGUE.hairCol),
} satisfies Record<OutfitCategory | "hairCol", z.ZodType>);

/** The characters a username may hold once lowercased (#36 C1): letters, digits and `_`. */
export const USERNAME_RE = /^[a-z0-9_]+$/;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/**
 * Why a sign-up field was refused; each code is a key of the catalogs' `auth.errors` (#36 C10). The
 * action translates it in the viewer's locale; the code never carries what was typed.
 */
export type AuthFieldError =
  "usernameRequired" | "usernameLength" | "usernameChars" | "passwordRequired" | "passwordLength";

/**
 * The OAuth providers the sign-in and sign-up screens offer, in button order (#36 C8; Google from the
 * owner's C18 review). The flows themselves are #49's (GitHub, Discord) and #828's (Google).
 */
export const OAUTH_PROVIDERS = ["github", "discord", "google"] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number];

/** The fields of the sign-up and sign-in forms; nothing else is ever read or stored (no email, R152). */
export type AuthField = "username" | "password";

/** Form keys React adds to a server action form posted before hydration; never user input. */
const isFrameworkKey = (key: string) => key.startsWith("$ACTION_");

/**
 * The `signUp` form (#36 C1): exactly `username` and `password`, each a single string. The username is
 * NFKC-folded and trimmed (kept as typed for display) and must be 3-20 characters of `USERNAME_RE` once
 * lowercased; the password 8-128 characters, untrimmed. Any other field fails the whole form.
 */
const signUpUsername = z
  .string()
  .max(256, "usernameLength")
  .transform((raw) => raw.normalize("NFKC").trim())
  .superRefine((name, ctx) => {
    if (name === "") ctx.addIssue({ code: "custom", message: "usernameRequired" });
    else if (name.length < USERNAME_MIN || name.length > USERNAME_MAX)
      ctx.addIssue({ code: "custom", message: "usernameLength" });
    else if (!USERNAME_RE.test(name.toLowerCase()))
      ctx.addIssue({ code: "custom", message: "usernameChars" });
  });

const signUpPassword = z.string().superRefine((pw, ctx) => {
  if (pw === "") ctx.addIssue({ code: "custom", message: "passwordRequired" });
  else if (pw.length < PASSWORD_MIN || pw.length > PASSWORD_MAX)
    ctx.addIssue({ code: "custom", message: "passwordLength" });
});

export type SignUpParse =
  | { ok: true; username: string; usernameNormalized: string; password: string }
  | { ok: false; fieldErrors: Partial<Record<AuthField, AuthFieldError>>; extraField: boolean };

/** Parses the sign-up FormData (#36 C1). A field given twice, or as a file, is refused like a bad value. */
export function parseSignUp(form: FormData): SignUpParse {
  const keys = [...new Set([...form.keys()].filter((k) => !isFrameworkKey(k)))];
  const extraField = keys.some((k) => k !== "username" && k !== "password");
  const single = (key: AuthField) => {
    const all = form.getAll(key);
    return all.length === 1 && typeof all[0] === "string" ? all[0] : "";
  };
  const username = signUpUsername.safeParse(single("username"));
  const password = signUpPassword.safeParse(single("password"));
  const fieldErrors: Partial<Record<AuthField, AuthFieldError>> = {};
  if (!username.success) fieldErrors.username = username.error.issues[0]!.message as AuthFieldError;
  if (!password.success) fieldErrors.password = password.error.issues[0]!.message as AuthFieldError;
  if (!username.success || !password.success || extraField) {
    return { ok: false, fieldErrors, extraField };
  }
  return {
    ok: true,
    username: username.data,
    usernameNormalized: normalizeUsername(username.data),
    password: password.data,
  };
}

/** The `signIn` form (#36 C5): username, password and the optional `callbackUrl`; bounds only. */
export function parseSignIn(form: FormData): {
  username: string;
  password: string;
  callbackUrl: string | null;
} {
  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };
  const callbackUrl = form.get("callbackUrl");
  return {
    username: text("username"),
    password: text("password"),
    callbackUrl: typeof callbackUrl === "string" ? callbackUrl : null,
  };
}

/** The fields of the `/reset` form (#789); nothing else is ever read. */
export type ResetField = "username" | "code" | "password";

/** Why a `/reset` field was refused; each is a key of the catalogs' `auth.reset.errors` (#789 C1). */
export type ResetFieldError =
  | "usernameRequired"
  | "usernameLength"
  | "usernameChars"
  | "codeRequired"
  | "codeFormat"
  | "passwordRequired"
  | "passwordLength";

/** A normalized reset code: exactly `RESET_CODE_LENGTH` Crockford base32 characters (#788). */
const RESET_CODE_RE = new RegExp(`^[${RESET_CODE_ALPHABET}]{${RESET_CODE_LENGTH}}$`);

const resetCode = z
  .string()
  .max(64, "codeFormat")
  .transform(normalizeResetCode)
  .superRefine((code, ctx) => {
    if (code === "") ctx.addIssue({ code: "custom", message: "codeRequired" });
    else if (!RESET_CODE_RE.test(code)) ctx.addIssue({ code: "custom", message: "codeFormat" });
  });

export type ResetParse =
  | { ok: true; usernameNormalized: string; code: string; password: string }
  | { ok: false; fieldErrors: Partial<Record<ResetField, ResetFieldError>>; extraField: boolean };

/**
 * The `/reset` form (#789 C1): `username` (the sign-up rules of #36, then `normalizeUsername`), `code`
 * (`normalizeResetCode`, then exactly 8 Crockford characters) and `password` (the sign-up rules),
 * each a single string. A field given twice or as a file is refused like a bad value; any other
 * field refuses the whole form (`extraField`).
 */
export function parseResetForm(form: FormData): ResetParse {
  const keys = [...new Set([...form.keys()].filter((k) => !isFrameworkKey(k)))];
  const extraField = keys.some((k) => k !== "username" && k !== "code" && k !== "password");
  const single = (key: ResetField) => {
    const all = form.getAll(key);
    return all.length === 1 && typeof all[0] === "string" ? all[0] : "";
  };
  const username = signUpUsername.safeParse(single("username"));
  const code = resetCode.safeParse(single("code"));
  const password = signUpPassword.safeParse(single("password"));
  const fieldErrors: Partial<Record<ResetField, ResetFieldError>> = {};
  if (!username.success)
    fieldErrors.username = username.error.issues[0]!.message as ResetFieldError;
  if (!code.success) fieldErrors.code = code.error.issues[0]!.message as ResetFieldError;
  if (!password.success)
    fieldErrors.password = password.error.issues[0]!.message as ResetFieldError;
  if (!username.success || !code.success || !password.success || extraField) {
    return { ok: false, fieldErrors, extraField };
  }
  return {
    ok: true,
    usernameNormalized: normalizeUsername(username.data),
    code: code.data,
    password: password.data,
  };
}

/** A recovery code as typed (#46 C3): at most 400 characters, then exactly 10 words of the list. */
const recoveryCode = z
  .string()
  .max(400, "codeFormat")
  .transform((raw) => ({ raw, canonical: canonicalRecoveryCode(raw) }))
  .superRefine(({ raw, canonical }, ctx) => {
    if (raw.trim() === "") ctx.addIssue({ code: "custom", message: "codeRequired" });
    else if (canonical === null) ctx.addIssue({ code: "custom", message: "codeFormat" });
  })
  .transform(({ canonical }) => canonical!);

/**
 * The `/recover` form (#46 C3): the `/reset` fields (`username`, `code`, `password`) with the recovery
 * code rules: 10 words of the list, order, case and accents ignored (`canonicalRecoveryCode`); the
 * username and new password follow sign-up. Same refusals as `parseResetForm`.
 */
export function parseRecoverForm(form: FormData): ResetParse {
  const keys = [...new Set([...form.keys()].filter((k) => !isFrameworkKey(k)))];
  const extraField = keys.some((k) => k !== "username" && k !== "code" && k !== "password");
  const single = (key: ResetField) => {
    const all = form.getAll(key);
    return all.length === 1 && typeof all[0] === "string" ? all[0] : "";
  };
  const username = signUpUsername.safeParse(single("username"));
  const code = recoveryCode.safeParse(single("code"));
  const password = signUpPassword.safeParse(single("password"));
  const fieldErrors: Partial<Record<ResetField, ResetFieldError>> = {};
  if (!username.success)
    fieldErrors.username = username.error.issues[0]!.message as ResetFieldError;
  if (!code.success) fieldErrors.code = code.error.issues[0]!.message as ResetFieldError;
  if (!password.success)
    fieldErrors.password = password.error.issues[0]!.message as ResetFieldError;
  if (!username.success || !code.success || !password.success || extraField) {
    return { ok: false, fieldErrors, extraField };
  }
  return {
    ok: true,
    usernameNormalized: normalizeUsername(username.data),
    code: code.data,
    password: password.data,
  };
}

/** The stored theme choice (`Preference.theme`); `SYSTEM` follows `prefers-color-scheme`. */
export const PREFERENCE_THEMES = ["LIGHT", "DARK", "SYSTEM"] as const;
export type PreferenceTheme = (typeof PREFERENCE_THEMES)[number];

/**
 * The seat-view machine skins a viewer may pick (#638, bible 7.7a): identity's own list, kept equal to the
 * race feature's `machineSkinIds` by `preferences.test.ts` (a new skin is registered there, then here).
 * `teleprinter` is the default and the column's default.
 */
export const PREFERENCE_MACHINE_SKINS = ["teleprinter"] as const;
export type PreferenceMachineSkin = (typeof PREFERENCE_MACHINE_SKINS)[number];
export const DEFAULT_MACHINE_SKIN: PreferenceMachineSkin = "teleprinter";
/** A stored or sent skin id; anything else is refused (the patch) or reads the default (the row). */
export const machineSkinSchema = z.enum(PREFERENCE_MACHINE_SKINS);

/**
 * `updatePreferences` input (#66 C1): the single list of preference keys. Every key is optional, a
 * `null` layout clears the choice, and unknown keys are refused (`strict`): the target is always the
 * viewer, never an id from the input. Adding a preference is one line here plus its column.
 */
export const preferencesPatch = z
  .object({
    layout: z.enum(keyboardLayoutIds).nullable().optional(),
    theme: z.enum(PREFERENCE_THEMES).optional(),
    locale: z.enum(LOCALES).optional(),
    sound: z.boolean().optional(),
    machineSkin: machineSkinSchema.optional(),
  })
  .strict();
export type PreferencesPatch = z.infer<typeof preferencesPatch>;

/** The viewer's settings as the screen reads them (#66 C2): every key resolved, defaults filled in. */
export type Preferences = {
  layout: KeyboardLayoutId | null;
  theme: PreferenceTheme;
  locale: Locale;
  sound: boolean;
  machineSkin: PreferenceMachineSkin;
};
