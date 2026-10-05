import type { Metadata } from "next";
import {
  Courier_Prime,
  IBM_Plex_Mono,
  Oswald,
  Special_Elite,
  Stardos_Stencil,
  VT323,
} from "next/font/google";
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

export const metadata: Metadata = {
  title: "App",
  description: "Built with the agent kit",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-bg text-fg">{children}</body>
    </html>
  );
}
