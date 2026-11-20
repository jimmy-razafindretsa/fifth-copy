import type { KeyboardLayoutId } from "@/features/identity";
import { GUIDE_CHARS, type GuideChar } from "./chars";

/**
 * The guide's content (#999 C26, #1001 C7): character x layout x OS -> the keys that type it, taken from
 * published layout data, fetched and checked on 2026-11-20: Microsoft's own layout diagrams for Windows,
 * Unicode CLDR release-41 keyboard files (machine-readable layouts generated from Apple's and Google's) for
 * macOS and ChromeOS, Microsoft's Alt-code page for a character a Windows layout has no key for, and
 * Google's accents menu for the ChromeOS US layout. Static data, no I/O.
 *
 * ChromeOS CSA: Chromium maps ChromeOS's Canadian Multilingual input to the XKB layout `ca(multix)`
 * (https://chromium.googlesource.com/chromium/src/+/main/chromeos/ime/input_methods.txt, line
 * `xkb:ca:multix:fra ca(multix) fr,fr-CA CA login`); its keys are read from xkeyboard-config's
 * `symbols/ca`, variant `multix` ("Canadian (CSA)"): level 3 = AltGr (`level3(ralt_switch)`), level 5 =
 * right Ctrl (`level5(rctrl_switch)`). macOS Canadian French: Apple publishes no layout file and CLDR has
 * none, so its pairs use Apple's own layout-independent methods: the press-and-hold accent menu for the
 * letters (`hold+<letter>, <char>`) and the Character Viewer (Fn/Globe+E, then pick) for « » €.
 *
 * The rule of this file: every pair carries the `source` URL of the exact layout it was read from and
 * `verifiedBy: "docs"`. A pair no source documents (a character a layout has no key for and no fallback)
 * is filed as `undocumented`, with the source that was searched, and the page says so: never a guess. Key names in the sources are physical
 * positions (Windows virtual keys, the US-QWERTY key at the same ISO position); here they are the key cap
 * a user of that layout sees, the character the key types unmodified. `work/log/1001.md` "Guide sources"
 * lists the sources per layout and OS; a real-device check is a separate follow-up card.
 *
 * "AZERTY" on Windows is French (Legacy), kbdfr, the most common. Windows 11's French (Standard) layout,
 * kbdfrna, differs (é è à on their own keys, ç ù œ æ on AltGr): https://learn.microsoft.com/en-us/globalization/keyboards/kbdfrna.html
 *
 * Keys are written as `"option+e, e"`: `+` joins keys held together, `, ` separates the strokes typed one
 * after the other. Modifier tokens (`shift`, `alt`, `altgr`, `option`, `ctrl`, `rctrl`, `cmd`, `fn`,
 * `space`, `hold`) are named in the reader's language by the page (`hold` is a word, not a key: hold the next key
 * down); `numpad130` is the Windows Alt code typed on the numeric keypad; anything else is the key cap as
 * printed (`^`, `é`, `` ` ``, `¸`).
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
export const GUIDE_MODIFIERS = [
  "shift",
  "alt",
  "altgr",
  "option",
  "ctrl",
  "rctrl",
  "cmd",
  "fn",
  "space",
  "hold",
] as const;
export type GuideModifier = (typeof GUIDE_MODIFIERS)[number];

/** One stroke: the keys held together. */
export type GuideStroke = readonly string[];

const CLDR = "https://github.com/unicode-org/cldr/blob/release-41/keyboards";
const MS = "https://learn.microsoft.com/en-us/globalization/keyboards";

/** The published layout data a pair is filed from (#1001 C7), one URL per layout. */
export const GUIDE_SOURCES = {
  /** Microsoft: Canadian Multilingual Standard (KLID 00011009), the CSA layout. */
  windowsCsa: `${MS}/kbdcan.html`,
  /** Microsoft: Canadian French (KLID 00001009). */
  windowsFrCa: `${MS}/kbdca.html`,
  /** Microsoft: French (Legacy, AZERTY) (KLID 0000040C). */
  windowsAzerty: `${MS}/kbdfr.html`,
  /** Microsoft: Alt + the code on the numeric keypad (the codes as the page lists them). */
  windowsAltCodes:
    "https://support.microsoft.com/en-us/office/insert-ascii-or-unicode-latin-based-symbols-and-characters-d13f58d3-7bcb-44a7-a4d5-972ee12e50e0",
  /** Unicode CLDR: macOS "U.S.". */
  macUs: `${CLDR}/osx/en-t-k0-osx.xml`,
  /** Unicode CLDR: macOS "Canadian - CSA". */
  macCsa: `${CLDR}/osx/fr-CA-t-k0-osx.xml`,
  /** Unicode CLDR: macOS "French" (AZERTY). */
  macAzerty: `${CLDR}/osx/fr-t-k0-osx.xml`,
  /** Apple: "Enter characters with accent marks on Mac" (hold the letter, pick the accent). */
  macAccents:
    "https://support.apple.com/guide/mac-help/enter-characters-with-accent-marks-on-mac-mh27474/mac",
  /** Apple: "Use emoji and symbols on Mac" (Fn/Globe+E opens the Character Viewer, pick the symbol). */
  macCharacterViewer:
    "https://support.apple.com/guide/mac-help/use-emoji-and-symbols-on-mac-mchlp1560/mac",
  /** xkeyboard-config: `symbols/ca` variant `multix` "Canadian (CSA)", ChromeOS's Canadian Multilingual. */
  chromeosCsa:
    "https://gitlab.freedesktop.org/xkeyboard-config/xkeyboard-config/-/raw/master/symbols/ca",
  /** Unicode CLDR: ChromeOS "Canada" (Canadian French). */
  chromeosFrCa: `${CLDR}/chromeos/fr-CA-t-k0-chromeos.xml`,
  /** Unicode CLDR: ChromeOS "France" (AZERTY). */
  chromeosAzerty: `${CLDR}/chromeos/fr-t-k0-chromeos.xml`,
  /** Google: the accents menu (turn on "Show accent marks and special characters", hold the letter). */
  chromebookAccents: "https://support.google.com/chromebook/answer/1059492",
} as const;
export type GuideSource = (typeof GUIDE_SOURCES)[keyof typeof GUIDE_SOURCES];

/** The source documents these keys for this layout and OS. */
export type GuideCombination = {
  readonly strokes: readonly GuideStroke[];
  /** Other documented ways, shown after "or". */
  readonly alternatives?: readonly (readonly GuideStroke[])[];
  readonly source: GuideSource;
  readonly verifiedBy: "docs";
  readonly undocumented?: false;
};

/** No source documents a way to type it on this layout and OS: stated, never invented. */
export type GuideUndocumented = {
  readonly strokes: readonly [];
  /** The source that was searched. */
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

const documented = (
  keys: string,
  source: GuideSource,
  alternatives: readonly string[] = [],
): GuideCombination => ({
  strokes: parseKeys(keys),
  ...(alternatives.length > 0 ? { alternatives: alternatives.map(parseKeys) } : {}),
  source,
  verifiedBy: "docs",
});
const undocumented = (source: GuideSource): GuideUndocumented => ({
  strokes: [],
  source,
  verifiedBy: "docs",
  undocumented: true,
});

/** The Alt codes as Microsoft's page lists them (hold Alt, type the code on the numeric keypad). */
const ALT_CODE: Record<GuideChar, string> = {
  é: "130",
  è: "138",
  ê: "136",
  ë: "137",
  à: "133",
  â: "131",
  ç: "135",
  ù: "151",
  û: "150",
  ô: "147",
  î: "140",
  ï: "139",
  œ: "0156",
  æ: "0230",
  "«": "0171",
  "»": "0187",
  "€": "0128",
};

/** A layout's keys per character, read from one source; a missing character has no key there. */
type Layout = {
  source: GuideSource;
  keys: Partial<Record<GuideChar, string>>;
  also?: Partial<Record<GuideChar, readonly string[]>>;
  /** A character read from another source than the layout's own. */
  sourceOf?: Partial<Record<GuideChar, GuideSource>>;
};

/** The circumflex and diaeresis letters, typed after the layout's dead key. */
const deadKeys = (circ: string, diaer: string): Partial<Record<GuideChar, string>> => ({
  ê: `${circ}, e`,
  â: `${circ}, a`,
  û: `${circ}, u`,
  ô: `${circ}, o`,
  î: `${circ}, i`,
  ë: `${diaer}, e`,
  ï: `${diaer}, i`,
});

/** Windows, from Microsoft's layout diagrams (rctrl = the right-Ctrl level the CSA diagram shows). */
const WINDOWS: Partial<Record<KeyboardLayoutId, Layout>> = {
  CSA: {
    source: GUIDE_SOURCES.windowsCsa,
    keys: {
      é: "é",
      è: "è",
      à: "à",
      ç: "ç",
      ù: "ù",
      ...deadKeys("^", "shift+^"),
      œ: "rctrl+e",
      æ: "rctrl+a",
      "«": "altgr+z",
      "»": "altgr+x",
      "€": "altgr+e",
    },
    // the AltGr dead grave of the same key
    also: { è: ["altgr+^, e"], à: ["altgr+^, a"], ù: ["altgr+^, u"] },
  },
  FR_CA: {
    source: GUIDE_SOURCES.windowsFrCa,
    keys: {
      é: "é",
      è: "`, e",
      à: "`, a",
      ù: "`, u",
      ç: "¸, c",
      ...deadKeys("^", "shift+¸"),
      "«": "«",
      "»": "shift+«",
      "€": "altgr+e",
    },
  },
  AZERTY: {
    source: GUIDE_SOURCES.windowsAzerty,
    keys: {
      é: "é",
      è: "è",
      à: "à",
      ç: "ç",
      ù: "ù",
      ...deadKeys("^", "shift+^"),
      "€": "altgr+e",
    },
  },
};

/** A menu that opens on holding a letter: hold the base letter, then pick the character. */
const holdMenu = (
  chars: readonly GuideChar[],
  base: Partial<Record<GuideChar, string>> = {},
): Partial<Record<GuideChar, string>> =>
  Object.fromEntries(
    chars.map((char) => [char, `hold+${base[char] ?? char.normalize("NFD")[0]!}, ${char}`]),
  );

/** The accented letters both accent menus (Apple's and Google's) document. */
const MENU_LETTERS = ["é", "è", "ê", "ë", "à", "â", "ç", "ù", "û", "ô", "î", "ï"] as const;

/** Apple's Character Viewer: Fn/Globe+E opens it, then pick the symbol (search it by name). */
const CHARACTER_VIEWER = ["«", "»", "€"] as const;

/** macOS, from the CLDR files of Apple's layouts, and Apple's own help pages for Canadian French. */
const MAC: Record<KeyboardLayoutId, Layout> = {
  FR_CA: {
    source: GUIDE_SOURCES.macAccents,
    keys: {
      ...holdMenu([...MENU_LETTERS, "œ", "æ"], { œ: "o", æ: "a" }),
      ...Object.fromEntries(CHARACTER_VIEWER.map((char) => [char, `fn+e, ${char}`])),
    },
    sourceOf: Object.fromEntries(
      CHARACTER_VIEWER.map((char) => [char, GUIDE_SOURCES.macCharacterViewer]),
    ),
  },
  US_QWERTY: {
    source: GUIDE_SOURCES.macUs,
    keys: {
      é: "option+e, e",
      è: "option+`, e",
      à: "option+`, a",
      ù: "option+`, u",
      ...deadKeys("option+i", "option+u"),
      ç: "option+c",
      œ: "option+q",
      æ: "option+'",
      "«": "option+\\",
      "»": "option+shift+\\",
      "€": "option+shift+2",
    },
  },
  CSA: {
    source: GUIDE_SOURCES.macCsa,
    keys: {
      é: "é",
      è: "è",
      à: "à",
      ç: "ç",
      ù: "ù",
      ...deadKeys("^", "shift+^"),
      œ: "option+q",
      æ: "option+a",
      "«": "option+z",
      "»": "option+x",
      "€": "option+4",
    },
  },
  AZERTY: {
    source: GUIDE_SOURCES.macAzerty,
    keys: {
      é: "é",
      è: "è",
      à: "à",
      ç: "ç",
      ù: "ù",
      ...deadKeys("^", "shift+^"),
      œ: "option+o",
      æ: "option+a",
      "«": "option+è",
      "»": "option+shift+è",
      "€": "option+$",
    },
  },
};

/**
 * ChromeOS, from the CLDR files of Google's layouts, xkeyboard-config's `ca(multix)` for CSA (the layout
 * Chromium maps ChromeOS's Canadian Multilingual to), and Google's accents menu for US.
 */
const CHROMEOS: Record<KeyboardLayoutId, Layout> = {
  CSA: {
    // multix: AB10 é, AC11 è, BKSL à, LSGT ù, AD12 ç; AD11 dead circumflex, shifted dead diaeresis, on
    // AltGr dead grave; AltGr+E/Z/X € « »; right Ctrl (level 5)+E/A œ æ
    source: GUIDE_SOURCES.chromeosCsa,
    keys: {
      é: "é",
      è: "è",
      à: "à",
      ç: "ç",
      ù: "ù",
      ...deadKeys("^", "shift+^"),
      œ: "rctrl+e",
      æ: "rctrl+a",
      "«": "altgr+z",
      "»": "altgr+x",
      "€": "altgr+e",
    },
    also: { è: ["altgr+^, e"], à: ["altgr+^, a"], ù: ["altgr+^, u"] },
  },
  FR_CA: {
    source: GUIDE_SOURCES.chromeosFrCa,
    keys: {
      é: "é",
      è: "`, e",
      à: "`, a",
      ù: "`, u",
      ç: "¸, c",
      ...deadKeys("^", "shift+¸"),
      "«": "«",
      "»": "shift+«",
    },
  },
  US_QWERTY: { source: GUIDE_SOURCES.chromebookAccents, keys: holdMenu(MENU_LETTERS) },
  AZERTY: {
    source: GUIDE_SOURCES.chromeosAzerty,
    keys: {
      é: "é",
      è: "è",
      à: "à",
      ç: "ç",
      ù: "ù",
      ...deadKeys("^", "shift+^"),
      æ: "altgr+a",
      "«": "altgr+z",
      "»": "altgr+x",
      "€": "altgr+e",
    },
  },
};

/** A pair from a layout's data; `fallback` when the layout has no key for the character. */
function fromLayout(
  layout: Layout | undefined,
  char: GuideChar,
  searched: GuideSource,
  fallback?: () => GuidePair,
): GuidePair {
  const keys = layout?.keys[char];
  if (layout && keys) {
    return documented(keys, layout.sourceOf?.[char] ?? layout.source, layout.also?.[char]);
  }
  if (fallback) return fallback();
  return undocumented(layout?.source ?? searched);
}

/** Windows: the layout's own key, dead key, AltGr or right-Ctrl key, else the Alt code (US: Alt codes only). */
const windowsPair = (layout: KeyboardLayoutId, char: GuideChar): GuidePair =>
  fromLayout(WINDOWS[layout], char, GUIDE_SOURCES.windowsAltCodes, () =>
    documented(`alt+numpad${ALT_CODE[char]}`, GUIDE_SOURCES.windowsAltCodes),
  );

/** macOS: CLDR's file of each layout; Canadian French (no file): Apple's accent menu and Character Viewer. */
const macPair = (layout: KeyboardLayoutId, char: GuideChar): GuidePair =>
  fromLayout(MAC[layout], char, MAC[layout].source);

/** ChromeOS: each layout's file (CSA: xkeyboard-config's ca(multix)); a character with no key: undocumented. */
const chromeosPair = (layout: KeyboardLayoutId, char: GuideChar): GuidePair =>
  fromLayout(CHROMEOS[layout], char, CHROMEOS[layout].source);

function pairsFor(char: GuideChar): GuidePairs {
  const pairs = {} as GuidePairs;
  for (const layout of GUIDE_LAYOUTS) {
    pairs[layout] = {
      windows: windowsPair(layout, char),
      mac: macPair(layout, char),
      chromeos: chromeosPair(layout, char),
    };
  }
  return pairs;
}

/** Every entry, in the page's order, each layout/OS pair from its published layout data (#1001 C7). */
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

/** True when the sources document at least one character for this layout and OS. */
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
