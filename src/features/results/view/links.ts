import { AUTH_LINKS } from "@/features/identity";
import { LINKS } from "@/features/landing";

/**
 * Every internal link the Dawn report offers (#899): the action row and filing notice (`home`, the
 * waiting room, `signUp`) and the tip's guide. Each is read from the guarded link tables, `LINKS` of the
 * landing and `AUTH_LINKS` of identity (#875: a link appears only when its route ships, links.test.ts
 * walks src/app), never written here again; the waiting room is the one dynamic path.
 */
export const REPORT_LINKS = {
  home: LINKS.home,
  guide: LINKS.guide,
  signUp: AUTH_LINKS.signUp,
  lobby: (code: string) => `/lobby/${code}`,
} as const;
