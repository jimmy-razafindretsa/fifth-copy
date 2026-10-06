import type { Metadata } from "next";
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
const stardos = Stardos_Stencil({
  weight: ["700"],
  subsets: ["latin"],
  display: "swap",
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
  variable: "--font-vt323",
});

const fontVariables = [stardos, oswald, plexMono, specialElite, courierPrime, vt323]
  .map((f) => f.variable)
  .join(" ");

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
    >
      <body className="flex min-h-full flex-col bg-bg text-fg">{children}</body>
    </html>
  );
}
