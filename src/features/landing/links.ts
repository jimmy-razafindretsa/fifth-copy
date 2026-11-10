import type { Outfit } from "@/features/identity";

/** The links whose route has shipped (ARCHITECTURE 8.1 route list): the landing always offers them. */
type ShippedLinks = { home: string; play: string; how: string; guide: string; signIn: string };

/**
 * Footer and personnel-file links the bible lists (14.1 items 5, 10) whose page is post-v1 (owner
 * decision 2026-11-10, #875): the locker, the teachers' page, the Personnel file (#311), about, privacy
 * (#76), terms and contact. A link appears when its route ships: add its path here once its `page.tsx`
 * exists and it comes back (links.test.ts walks src/app); the catalog keys stay.
 */
export type HeldBackLink =
  "locker" | "teachers" | "profile" | "about" | "privacy" | "terms" | "contact";

/**
 * Where the landing's links go. The guide link anchors to "How a race runs" until the special-characters
 * guide (card 388) exists, as the reference does.
 */
export const LINKS: ShippedLinks & Partial<Record<HeldBackLink, string>> = {
  home: "/",
  play: "#play",
  how: "#how",
  guide: "#how",
  signIn: "/sign-in",
};

export type SocialKey = "github" | "linkedin" | "discord" | "youtube";
export type SocialLink = { key: SocialKey; tag: string; href: string };

/**
 * Aegis Corp. channels (bible 14.1 item 10): empty until the team publishes real profiles, so the social
 * row is not rendered (#875). Each entry is a profile URL, never a site's home page (links.test.ts).
 */
export const SOCIAL_LINKS: readonly SocialLink[] = [];

/**
 * The embeds generated from the bible's reference pages by scripts/embeds.ts (bible 15, 16). The live
 * feed is a recorded loop of the lobby scene since #552 (feed-media.ts), not an embed.
 */
export const EMBEDS = {
  clerk: "/3d/clerk.html",
  medal: "/3d/medal.html",
} as const;

/**
 * The clerk embed's URL: with the viewer's saved outfit as `?cfg=` (bible 15, #687) so the first frame
 * already wears it, or the plain page (a random issue) when nothing is saved.
 */
export function clerkEmbedSrc(outfit: Outfit | null): string {
  return outfit
    ? `${EMBEDS.clerk}?cfg=${encodeURIComponent(JSON.stringify(outfit))}`
    : EMBEDS.clerk;
}
