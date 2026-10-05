/**
 * Where the landing's links go (ARCHITECTURE 8.1 route list). Routes whose cards have not landed yet
 * answer 404 until they do; the guide link anchors to "How a race runs" until the special-characters
 * guide (card 388) exists, as the reference does.
 */
export const LINKS = {
  home: "/",
  play: "#play",
  how: "#how",
  guide: "#how",
  signIn: "/sign-in",
  locker: "/locker",
  teachers: "/teachers",
  profile: "/profile",
  about: "/about",
  privacy: "/privacy",
  terms: "/terms",
  contact: "/contact",
} as const;

/** Aegis Corp. channels: the reference's placeholders until the team publishes its profiles. */
export const SOCIAL_LINKS = [
  { key: "github", tag: "GH", href: "https://github.com" },
  { key: "linkedin", tag: "IN", href: "https://linkedin.com" },
  { key: "discord", tag: "DC", href: "https://discord.com" },
  { key: "youtube", tag: "YT", href: "https://youtube.com" },
] as const;

/** The embeds generated from the bible's reference pages by scripts/embeds.ts (bible 15, 16). */
export const EMBEDS = {
  lobby: "/3d/lobby.html?embed=1",
  clerk: "/3d/clerk.html",
  medal: "/3d/medal.html",
} as const;
