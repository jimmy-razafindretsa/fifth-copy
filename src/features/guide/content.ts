import type { KeyboardLayoutId } from "@/features/identity";
import { GUIDE_CHARS, type GuideChar } from "./chars";

/**
 * The guide's content (#999 C26, #1001 C7): character x layout x OS -> the keys that type it, taken from
 * the vendor's published layout documentation (Microsoft's keyboard layouts and Alt codes, Apple's accent
 * and Keyboard Viewer pages, Google's Chromebook shortcuts). Static data, no I/O.
 *
 * The rule of this file (#1001 C7, replacing #999 C27's real-machine checks): every pair carries the
 * `source` URL that documents it and `verifiedBy: "docs"`. A pair the vendor does not document (Apple
 * publishes no key chart for the Canadian and French input sources) is filed as `undocumented`, with the
 * page that was searched, and the page says so: never a guess. `work/log/1001.md` "Guide sources" lists
 * the sources per layout and OS; a real-device check is a separate follow-up card.
 *
 * Keys are written as `"option+e, e"`: `+` joins keys held together, `, ` separates the strokes typed one
 * after the other. Modifier tokens (`shift`, `alt`, `altgr`, `option`, `ctrl`, `cmd`, `space`) are named
 * in the reader's language by the page; `numpad0233` is the Windows Alt code typed on the numeric keypad;
 * anything else is the key cap as printed (`^`, `é`, `` ` ``, `¸`) or a hexadecimal code (`e9`).
 */

export const GUIDE_OSES = ["windows", "mac", "chromeos"] as const;

/**
 * The layouts the guide covers, in the settings order: every identity layout (the record makes a new
 * layout a type error here until the guide files it). Type-only import, so the content stays free of
 * identity's runtime.
 */
const LAYOUT_ORDER: Record<KeyboardLayoutId, number> = {
  CSA: 0,
  FR_CA: 1,
  US_QWERTY: 2,
  AZERTY: 3,
};
export const GUIDE_LAYOUTS = (Object.keys(LAYOUT_ORDER) as KeyboardLayoutId[]).sort(
  (a, b) => LAYOUT_ORDER[a] - LAYOUT_ORDER[b],
);
export type GuideOs = (typeof GUIDE_OSES)[number];

/** The modifier tokens the page names per locale; every other token is a printed key cap. */
export const GUIDE_MODIFIERS = ["shift", "alt", "altgr", "option", "ctrl", "cmd", "space"] as const;
export type GuideModifier = (typeof GUIDE_MODIFIERS)[number];

/** One stroke: the keys held together. */
export type GuideStroke = readonly string[];

/** The vendor documentation a pair is filed from (#1001 C7). */
export const GUIDE_SOURCES = {
  /** Microsoft: the Windows keyboard layouts (Canadian Multilingual Standard, Canadian French, French, US). */
  windowsLayouts: "https://learn.microsoft.com/en-us/globalization/windows-keyboard-layouts",
  /** Microsoft: Alt + the decimal code on the numeric keypad. */
  windowsAltCodes:
    "https://support.microsoft.com/en-us/office/insert-ascii-or-unicode-latin-based-symbols-and-characters-d13f58d3-7bcb-44a7-a4d5-972ee12e50e0",
  /** Apple: accent marks with the Option dead keys. */
  macAccents:
    "https://support.apple.com/guide/mac-help/enter-characters-with-accent-marks-on-mac-mh27474/mac",
  /** Apple: the Keyboard Viewer (the input source's keys with Option and Shift). */
  macViewer: "https://support.apple.com/guide/mac-help/use-the-keyboard-viewer-mchlp1015/mac",
  /** Google: Chromebook keyboard shortcuts (Unicode entry: Ctrl + Shift + U, the code, Space). */
  chromebook: "https://support.google.com/chromebook/answer/183101",
} as const;
export type GuideSource = (typeof GUIDE_SOURCES)[keyof typeof GUIDE_SOURCES];

/** The vendor documents these keys for this layout and OS. */
export type GuideCombination = {
  readonly strokes: readonly GuideStroke[];
  readonly source: GuideSource;
  readonly verifiedBy: "docs";
  readonly undocumented?: false;
};

/** The vendor documents no way to type it on this layout and OS: stated, never invented. */
export type GuideUndocumented = {
  readonly strokes: readonly [];
  /** The page that was searched. */
  readonly source: GuideSource;
  readonly verifiedBy: "docs";
  readonly undocumented: true;
};

export type GuidePair = GuideCombination | GuideUndocumented;

export type GuidePairs = Record<KeyboardLayoutId, Record<GuideOs, GuidePair>>;

export type GuideEntry = { char: GuideChar; anchor: string; pairs: GuidePairs };

/** `"option+e, e"` -> `[["option","e"],["e"]]`. */
export function parseKeys(keys: string): GuideStroke[] {
  return keys.split(", ").map((stroke) => stroke.split("+"));
}

const documented = (keys: string, source: GuideSource): GuideCombination => ({
  strokes: parseKeys(keys),
  source,
  verifiedBy: "docs",
});
const undocumented = (source: GuideSource): GuideUndocumented => ({
  strokes: [],
  source,
  verifiedBy: "docs",
  undocumented: true,
});

/** Windows Alt codes (hold Alt, type the code on the numeric keypad), for any layout. */
const ALT_CODE: Record<GuideChar, string> = {
  é: "0233",
  è: "0232",
  ê: "0234",
  ë: "0235",
  à: "0224",
  â: "0226",
  ç: "0231",
  ù: "0249",
  û: "0251",
  ô: "0244",
  î: "0238",
  ï: "0239",
  œ: "0156",
  æ: "0230",
  "«": "0171",
  "»": "0187",
  "€": "0128",
};

/** ChromeOS Unicode entry (Ctrl+Shift+U, the code point, Space), for any layout. */
const UNICODE: Record<GuideChar, string> = {
  é: "e9",
  è: "e8",
  ê: "ea",
  ë: "eb",
  à: "e0",
  â: "e2",
  ç: "e7",
  ù: "f9",
  û: "fb",
  ô: "f4",
  î: "ee",
  ï: "ef",
  œ: "153",
  æ: "e6",
  "«": "ab",
  "»": "bb",
  "€": "20ac",
};

/** The base letter under an accent (`ê` -> `e`), for the dead-key strokes. */
const base = (char: GuideChar) => char.normalize("NFD")[0]!;

/** macOS U.S. input source: Apple's Option dead keys, then the letter. */
const MAC_US_DEAD: Partial<Record<GuideChar, string>> = {
  é: "option+e, e",
  è: "option+`, e",
  ê: "option+i, e",
  ë: "option+u, e",
  à: "option+`, a",
  â: "option+i, a",
  ù: "option+`, u",
  û: "option+i, u",
  ô: "option+i, o",
  î: "option+i, i",
  ï: "option+u, i",
};

/** macOS U.S. input source: the Option keys the Keyboard Viewer shows for the rest. */
const MAC_US_OPTION: Partial<Record<GuideChar, string>> = {
  ç: "option+c",
  œ: "option+q",
  æ: "option+'",
  "«": "option+\\",
  "»": "option+shift+\\",
  "€": "option+shift+2",
};

/** Letters with their own key on the Windows layout (Microsoft's layout pages). */
const DIRECT: Partial<Record<KeyboardLayoutId, readonly GuideChar[]>> = {
  CSA: ["é", "è", "à", "ç", "ù"],
  FR_CA: ["é"],
  AZERTY: ["é", "è", "ç", "à", "ù"],
};

type Accent = "circ" | "diaer" | "grave" | "cedil";

/** The Windows layout's dead key for each accent (circumflex `^`; diaeresis; grave; cedilla). */
const DEAD: Partial<Record<KeyboardLayoutId, Partial<Record<Accent, string>>>> = {
  CSA: { circ: "^", diaer: "shift+^" },
  FR_CA: { circ: "^", diaer: "shift+¸", grave: "`", cedil: "¸" },
  AZERTY: { circ: "^", diaer: "shift+^" },
};

const ACCENT: Partial<Record<GuideChar, Accent>> = {
  ê: "circ",
  â: "circ",
  û: "circ",
  ô: "circ",
  î: "circ",
  ë: "diaer",
  ï: "diaer",
  è: "grave",
  à: "grave",
  ù: "grave",
  ç: "cedil",
};

/** AltGr keys on the Windows layout (the right Alt key). */
const ALTGR: Partial<Record<KeyboardLayoutId, Partial<Record<GuideChar, string>>>> = {
  CSA: { "«": "altgr+z", "»": "altgr+x" },
  AZERTY: { "€": "altgr+e" },
};

/** Windows: the layout's own key, dead key or AltGr key, else the Alt code (any layout). */
function windowsPair(layout: KeyboardLayoutId, char: GuideChar): GuideCombination {
  const layouts = GUIDE_SOURCES.windowsLayouts;
  if (DIRECT[layout]?.includes(char)) return documented(char, layouts);
  const accent = ACCENT[char];
  const dead = accent ? DEAD[layout]?.[accent] : undefined;
  if (dead) return documented(`${dead}, ${base(char)}`, layouts);
  const altGr = ALTGR[layout]?.[char];
  if (altGr) return documented(altGr, layouts);
  return documented(`alt+numpad${ALT_CODE[char]}`, GUIDE_SOURCES.windowsAltCodes);
}

/** macOS: Apple documents the U.S. input source only; the other input sources have no published chart. */
function macPair(layout: KeyboardLayoutId, char: GuideChar): GuidePair {
  if (layout !== "US_QWERTY") return undocumented(GUIDE_SOURCES.macViewer);
  const dead = MAC_US_DEAD[char];
  if (dead) return documented(dead, GUIDE_SOURCES.macAccents);
  return documented(MAC_US_OPTION[char]!, GUIDE_SOURCES.macViewer);
}

/** ChromeOS: Google documents Unicode entry for any layout (no per-layout key chart is published). */
const chromeosPair = (char: GuideChar): GuideCombination =>
  documented(`ctrl+shift+u, ${UNICODE[char]}, space`, GUIDE_SOURCES.chromebook);

function pairsFor(char: GuideChar): GuidePairs {
  const pairs = {} as GuidePairs;
  for (const layout of GUIDE_LAYOUTS) {
    pairs[layout] = {
      windows: windowsPair(layout, char),
      mac: macPair(layout, char),
      chromeos: chromeosPair(char),
    };
  }
  return pairs;
}

/** Every entry, in the page's order, each layout/OS pair from the vendor's documentation (#1001 C7). */
export const GUIDE_CONTENT: readonly GuideEntry[] = GUIDE_CHARS.map(({ char, anchor }) => ({
  char,
  anchor,
  pairs: pairsFor(char),
}));

/** The combination the page shows for a pair: a documented one; an undocumented pair shows none. */
export function shownCombination(
  entry: GuideEntry,
  layout: KeyboardLayoutId,
  os: GuideOs,
): GuideCombination | null {
  const pair = entry.pairs[layout]?.[os];
  return pair && !pair.undocumented ? pair : null;
}

/** True when the vendor documents at least one character for this layout and OS. */
export function pairDocumented(
  content: readonly GuideEntry[],
  layout: KeyboardLayoutId,
  os: GuideOs,
): boolean {
  return content.some((entry) => shownCombination(entry, layout, os) !== null);
}

/** The sources the shown pairs of a layout cite, for the given systems, in a stable order. */
export function sourcesFor(
  content: readonly GuideEntry[],
  layout: KeyboardLayoutId,
  oses: readonly GuideOs[],
): GuideSource[] {
  const seen = new Set<GuideSource>();
  for (const os of oses) {
    for (const entry of content) {
      const shown = shownCombination(entry, layout, os);
      if (shown) seen.add(shown.source);
    }
  }
  return Object.values(GUIDE_SOURCES).filter((s) => seen.has(s));
}
