import type { CSSProperties } from "react";
import localFont from "next/font/local";

// The six brand families (art-direction 7, components.md "Fonts"), loaded through next/font/local from the
// committed woff2 subsets in public/fonts (#574): the exact files Google Fonts serves, vendored once by
// scripts/fonts-vendor.ts with their licences, so `next build` never needs the network for fonts.
// next/font/local has no per-file unicode-range, so each family is one call per subset (latin, latin-ext,
// cyrillic as listed in components.md). The first call of a family is named after it (the const name is the
// CSS family name) and carries the --font-* variable; the other subset calls add their faces to that
// family through a font-family declaration, without a fallback face of their own.
// Stardos Stencil and Special Elite have no Cyrillic, and next/font's size-adjusted fallback face is
// local("Arial"), which would draw Cyrillic before the role stack reaches Oswald (bible 17: no Arial).
// So their roles use the bare face (--face-*, below) followed by Oswald (#20), and adjustFontFallback is false.
// Flavour (Special Elite) and device (VT323) faces are not preloaded (#511): few routes paint them first,
// so they load on demand when used; the other four keep next/font's default preload.
// next/font needs literal options in every call: no shared constants, loops or helpers here.

export const Stardos_Stencil = localFont({
  src: [
    { path: "../../public/fonts/stardos-stencil-700-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
  adjustFontFallback: false,
  variable: "--font-stardos",
});

export const Oswald = localFont({
  src: [
    { path: "../../public/fonts/oswald-600-700-latin.woff2", weight: "600", style: "normal" },
    { path: "../../public/fonts/oswald-600-700-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
  variable: "--font-oswald",
});

export const Oswald_latin_ext = localFont({
  src: [
    { path: "../../public/fonts/oswald-600-700-latin-ext.woff2", weight: "600", style: "normal" },
    { path: "../../public/fonts/oswald-600-700-latin-ext.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  declarations: [
    { prop: "font-family", value: "Oswald" },
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
  adjustFontFallback: false,
});

export const Oswald_cyrillic = localFont({
  src: [
    { path: "../../public/fonts/oswald-600-700-cyrillic.woff2", weight: "600", style: "normal" },
    { path: "../../public/fonts/oswald-600-700-cyrillic.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  declarations: [
    { prop: "font-family", value: "Oswald" },
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
  adjustFontFallback: false,
});

export const IBM_Plex_Mono = localFont({
  src: [
    { path: "../../public/fonts/ibm-plex-mono-400-latin.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/ibm-plex-mono-700-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
  variable: "--font-plex-mono",
});

export const IBM_Plex_Mono_latin_ext = localFont({
  src: [
    {
      path: "../../public/fonts/ibm-plex-mono-400-latin-ext.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/ibm-plex-mono-700-latin-ext.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  display: "swap",
  declarations: [
    { prop: "font-family", value: "IBM_Plex_Mono" },
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
  adjustFontFallback: false,
});

export const IBM_Plex_Mono_cyrillic = localFont({
  src: [
    { path: "../../public/fonts/ibm-plex-mono-400-cyrillic.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/ibm-plex-mono-700-cyrillic.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  declarations: [
    { prop: "font-family", value: "IBM_Plex_Mono" },
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
  adjustFontFallback: false,
});

export const Special_Elite = localFont({
  src: [
    { path: "../../public/fonts/special-elite-400-latin.woff2", weight: "400", style: "normal" },
  ],
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
  adjustFontFallback: false,
  preload: false,
  variable: "--font-special-elite",
});

export const Special_Elite_latin_ext = localFont({
  src: [
    {
      path: "../../public/fonts/special-elite-400-latin-ext.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  declarations: [
    { prop: "font-family", value: "Special_Elite" },
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
  adjustFontFallback: false,
  preload: false,
});

export const Courier_Prime = localFont({
  src: [
    { path: "../../public/fonts/courier-prime-400-latin.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/courier-prime-700-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
  variable: "--font-courier-prime",
});

export const Courier_Prime_latin_ext = localFont({
  src: [
    {
      path: "../../public/fonts/courier-prime-400-latin-ext.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/courier-prime-700-latin-ext.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  display: "swap",
  declarations: [
    { prop: "font-family", value: "Courier_Prime" },
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
  adjustFontFallback: false,
});

export const VT323 = localFont({
  src: [{ path: "../../public/fonts/vt323-400-latin.woff2", weight: "400", style: "normal" }],
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
  preload: false,
  variable: "--font-vt323",
});

export const VT323_latin_ext = localFont({
  src: [{ path: "../../public/fonts/vt323-400-latin-ext.woff2", weight: "400", style: "normal" }],
  display: "swap",
  declarations: [
    { prop: "font-family", value: "VT323" },
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
  adjustFontFallback: false,
  preload: false,
});

export const fontVariables = [
  Stardos_Stencil,
  Oswald,
  IBM_Plex_Mono,
  Special_Elite,
  Courier_Prime,
  VT323,
]
  .map((f) => f.variable)
  .join(" ");

/** The first family of a next/font stack: the real face, without next/font's fallback face. */
const face = (font: { style: { fontFamily: string } }) =>
  font.style.fontFamily.split(",")[0]?.trim() ?? "";

export const faceVariables = {
  "--face-stardos": face(Stardos_Stencil),
  "--face-special-elite": face(Special_Elite),
} as CSSProperties;
