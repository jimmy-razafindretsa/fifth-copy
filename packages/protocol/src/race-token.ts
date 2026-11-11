import { z } from "zod";
import { avatarVersionSchema, idSchema, nameSchema, raceRoleSchema } from "./race";
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
  /**
   * The version of `sub`'s approved avatar when the web minted the token, or null (#730): display
   * data only, it grants nothing. The roll's portrait (`Member.avatar`) is addressed with it; the
   * avatar route still decides who may see the picture (ADR 0014, 0022). Absent reads as null.
   */
  avatar: avatarVersionSchema.nullable().default(null),
});
export type RaceTokenClaims = z.infer<typeof raceTokenClaimsSchema>;
