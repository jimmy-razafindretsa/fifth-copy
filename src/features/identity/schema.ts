import { z } from "zod";
import { OUTFIT_CATALOGUE, type OutfitCategory } from "./clerk/outfit";

/** Canonical form for case-insensitive username uniqueness (stored in User.usernameNormalized). */
export function normalizeUsername(username: string): string {
  return username.normalize("NFKC").trim().toLowerCase();
}

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
