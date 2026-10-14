import { z } from "zod";
import { raceIdSchema } from "@fifth-copy/protocol";

/** Wire schemas the race socket client parses at the edge. Declared in @fifth-copy/protocol, never here. */
export { rejectReasonSchema, rosterSchema, welcomeSchema } from "@fifth-copy/protocol";

/**
 * The `[raceId]` segment of `/race/[raceId]` (#561 C1): a `Race.id` (the race server's uuid v4, the
 * `countdown.race.raceId` of a started race) or a `Lobby.id` (a Prisma `cuid()`, the room's identity on
 * the race server, for a page opened before any start). The two shapes never overlap (a uuid has dashes,
 * a cuid none), so the parse also says which table to read. A cuid v1 is 25 characters; 32 is the cap.
 */
export const raceSeatIdSchema = z.union([
  raceIdSchema.transform((id) => ({ table: "race" as const, id })),
  z
    .cuid()
    .max(32)
    .transform((id) => ({ table: "lobby" as const, id })),
]);
