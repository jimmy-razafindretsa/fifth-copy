import { z } from "zod";
import { idSchema, nameSchema, raceRoleSchema } from "./race";
import { versionSchema } from "./version";

/** Race token lifetime in seconds (ADR 0006, ADR 0009). `exp`/`iat` are JWT registered claims. */
export const RACE_TOKEN_TTL_S = 300;

/** Claims of the HS256 race token minted by the web app and verified by the race server. */
export const raceTokenClaimsSchema = z.object({
  v: versionSchema,
  sub: idSchema,
  name: nameSchema,
  lobby: idSchema,
  role: raceRoleSchema,
});
export type RaceTokenClaims = z.infer<typeof raceTokenClaimsSchema>;
