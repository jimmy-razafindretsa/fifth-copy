/**
 * The stored race settings the award steps read (#999 C35, C41): `Race.settings` is untyped JSON (the
 * wire's race settings), parsed here, never trusted. Server side only (zod).
 */
import { z } from "zod";
import { textTypeSchema } from "@fifth-copy/protocol";

const raceSettingsFactsSchema = z.object({
  textType: textTypeSchema,
  accentEveryWord: z.boolean().catch(false),
});

export type RaceSettingsFacts = z.infer<typeof raceSettingsFactsSchema>;

/** `Race.settings` to its facts, or `null` when the stored value has no valid text type. */
export function raceSettingsFacts(settings: unknown): RaceSettingsFacts | null {
  const parsed = raceSettingsFactsSchema.safeParse(settings);
  return parsed.success ? parsed.data : null;
}
