import { z } from "zod";
import { ROOM_CODE_RE } from "@fifth-copy/protocol/room-code";
import { normalizeUsername } from "@/lib/username";
import { OUTFIT_CATALOGUE, type OutfitCategory } from "./clerk/outfit";

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
