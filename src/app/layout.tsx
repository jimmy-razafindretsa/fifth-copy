import type { Metadata } from "next";
import type { CSSProperties } from "react";
import {
  Courier_Prime,
  IBM_Plex_Mono,
  Oswald,
  Special_Elite,
  Stardos_Stencil,
  VT323,
} from "next/font/google";
import { getTheme } from "@/features/preferences";
import { getLocale, getT } from "@/i18n";
import "./globals.css";

// The six brand families (art-direction 7, components.md "Fonts"), self-hosted at build.
// Role tokens in docs/design/tokens.css map --font-<role> to these variables.
// Stardos Stencil and Special Elite have no Cyrillic, and next/font's size-adjusted fallback face is
// local("Arial"), which would draw Cyrillic before the role stack reaches Oswald (bible 17: no Arial).
// So their roles use the bare face (--face-*, below) followed by Oswald (#20). adjustFontFallback: false
// drops that Arial face under webpack; Turbopack (Next 16.3) still emits it, hence the --face-* variables.
// Flavour (Special Elite) and device (VT323) faces are not preloaded (#511): few routes paint them first,
// so they load on demand when used; the other four keep next/font's default preload.
const stardos = Stardos_Stencil({
  weight: ["700"],
  subsets: ["latin"],
  display: "swap",
  adjustFontFallback: false,
  variable: "--font-stardos",
});

const oswald = Oswald({
  weight: ["600", "700"],
  subsets: ["latin", "latin-ext", "cyrillic"],
  display: "swap",
  variable: "--font-oswald",
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "700"],
  subsets: ["latin", "latin-ext", "cyrillic"],
  display: "swap",
  variable: "--font-plex-mono",
});

const specialElite = Special_Elite({
  weight: ["400"],
  subsets: ["latin", "latin-ext"],
  display: "swap",
  adjustFontFallback: false,
  preload: false,
  variable: "--font-special-elite",
});

const courierPrime = Courier_Prime({
  weight: ["400", "700"],
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-courier-prime",
});

const vt323 = VT323({
  weight: ["400"],
  subsets: ["latin", "latin-ext"],
  display: "swap",
  preload: false,
  variable: "--font-vt323",
});

const fontVariables = [stardos, oswald, plexMono, specialElite, courierPrime, vt323]
  .map((f) => f.variable)
  .join(" ");

/** The first family of a next/font stack: the real face, without next/font's fallback face. */
const face = (font: { style: { fontFamily: string } }) =>
  font.style.fontFamily.split(",")[0]?.trim() ?? "";

const faceVariables = {
  "--face-stardos": face(stardos),
  "--face-special-elite": face(specialElite),
} as CSSProperties;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.meta.title, description: t.meta.description };
}

/**
 * `<html lang>` follows the locale cookie (ADR 0010) and `data-theme` the theme cookie (ARCHITECTURE 8.4);
 * with no theme cookie the attribute is absent and tokens.css follows `prefers-color-scheme`.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, theme] = await Promise.all([getLocale(), getTheme()]);
  return (
    <html
      lang={locale}
      data-theme={theme ?? undefined}
      className={`${fontVariables} h-full antialiased`}
      style={faceVariables}
    >
      <body className="type-body flex min-h-full flex-col bg-bg text-fg">{children}</body>
    </html>
  );
}
