import { z } from "zod";

// Untrusted input of joinByCode and mintRaceToken; the code itself is normalised by parseRoomCode.
export const codeInputSchema = z.object({ code: z.string().trim().min(1).max(16) });
/** mintRaceToken's input: `spectator` asks for a read-only token (#187). */
export const mintRaceTokenInputSchema = codeInputSchema.extend({
  spectator: z.boolean().optional(),
});
