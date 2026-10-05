import { z } from "zod";
import { versionSchema } from "./version";

/** Race token lifetime in seconds (ADR 0006, ADR 0009). `exp`/`iat` are JWT registered claims. */
export const RACE_TOKEN_TTL_S = 300;

/** Claims of the HS256 race token minted by the web app and verified by the race server. */
export const raceTokenClaimsSchema = z.object({
  v: versionSchema,
  sub: z.string().min(1),
  name: z.string().min(1),
  lobby: z.string().min(1),
  role: z.enum(["host", "player"]),
});
export type RaceTokenClaims = z.infer<typeof raceTokenClaimsSchema>;
