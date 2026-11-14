import type { Outfit } from "@/features/identity";

/** The links whose route has shipped (ARCHITECTURE 8.1 route list): the landing always offers them. */
type ShippedLinks = {
  home: string;
  play: string;
  how: string;
  guide: string;
  signIn: string;
  privacy: string;
  profile: string;
  /** The landing at a stable URL for a viewer, whose `/` is the Home menu (#943 C5). */
  landing: string;
  /** The landing's open-rooms docket (OPEN ROOMS on the Home menu, #943 C5). */
  rooms: string;
};

/**
 * Footer and personnel-file links the bible lists (14.1 items 5, 10) whose page is post-v1 (owner
 * decision 2026-11-10, #875): the locker, the teachers' page, about, terms and contact. A link appears
 * when its route ships: add its path here once its `page.tsx` exists and it comes back (links.test.ts
 * walks src/app); the catalog keys stay. Privacy shipped with #76, the Personnel file with #932.
 */
export type HeldBackLink = "locker" | "teachers" | "about" | "terms" | "contact";

/**
 * Where the landing's links go. The guide link anchors to the landing's "How a race runs" until the
 * special-characters guide (card 388) exists, as the reference does. It is the one guide href: the site
 * header and the Dawn report's tip (`REPORT_LINKS` of the results feature, #899) both read it, from any
 * page, so it names the landing at its stable URL (`/welcome#how`, #943: `/` is the Home menu for a
 * viewer); on the landing itself the header keeps the in-page anchor (`how`). Pointing the guide at its
 * own route is this one line.
 */
export const LINKS: ShippedLinks & Partial<Record<HeldBackLink, string>> = {
  home: "/",
  play: "#play",
  how: "#how",
  guide: "/welcome#how",
  signIn: "/sign-in",
  privacy: "/privacy",
  profile: "/profile",
  landing: "/welcome",
  rooms: "/welcome#rooms",
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
