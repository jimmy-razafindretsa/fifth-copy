/**
 * The race feature's handle on the desk identity (#565): the pure helper lives in `src/lib` (#731), so
 * the lobby's seat ring reads the same inks without pulling this feature's socket chunk into its first
 * load (ADR 0018). The race index re-exports it from here.
 */
export {
  identityOfDesk,
  RIVAL_INKS,
  rivalIdentity,
  type IdentityInk,
  type RivalIdentity,
  type RivalInk,
} from "@/lib/rival-identity";
