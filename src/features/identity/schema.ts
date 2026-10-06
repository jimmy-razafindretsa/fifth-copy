import { z } from "zod";

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
