import type { KeyboardLayoutId } from "@/features/identity";
import { GUIDE_CHARS, type GuideChar } from "./chars";

/**
 * The guide's content (#999 C26, C27): character x layout x OS -> the keys that type it, and the
 * real-machine check that verified them. Static data, no I/O.
 *
 * C27, the rule of this file: a combination is SHOWN only when `check` names a row of the "Guide checks"
 * table in `work/log/999.md` (a person typed it on a real machine with that layout and OS and wrote it
 * down). `check: null` is a candidate: filed here so the owner can verify it, never rendered; its pair
 * renders the empty state. content.test.ts holds every check to its log row. Never set `check` from a
 * memory, a web page or a layout chart: only from a log row.
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

export type GuideCombination = {
  /** The strokes, in order. */
  strokes: readonly GuideStroke[];
  /** The check id of a row of `work/log/999.md` "Guide checks", or null: a candidate, never shown. */
  check: string | null;
};

export type GuidePairs = Partial<
  Record<KeyboardLayoutId, Partial<Record<GuideOs, GuideCombination>>>
>;

export type GuideEntry = { char: GuideChar; anchor: string; pairs: GuidePairs };

/** `"option+e, e"` -> `[["option","e"],["e"]]`. */
export function parseKeys(keys: string): GuideStroke[] {
  return keys.split(", ").map((stroke) => stroke.split("+"));
}

/** A combination nobody has checked yet: data for the owner, never on the page. */
const candidate = (keys: string): GuideCombination => ({ strokes: parseKeys(keys), check: null });

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

const altCode = (char: GuideChar) => candidate(`alt+numpad${ALT_CODE[char]}`);
const unicode = (char: GuideChar) => candidate(`ctrl+shift+u, ${UNICODE[char]}, space`);

/** The base letter under an accent (`ê` -> `e`), for the dead-key strokes. */
const base = (char: GuideChar) => char.normalize("NFD")[0]!;

/** US QWERTY on macOS (the "U.S." input source): Option dead keys, then the letter. */
const MAC_US: Record<GuideChar, string> = {
  é: "option+e, e",
  è: "option+`, e",
  ê: "option+i, e",
  ë: "option+u, e",
  à: "option+`, a",
  â: "option+i, a",
  ç: "option+c",
  ù: "option+`, u",
  û: "option+i, u",
  ô: "option+i, o",
  î: "option+i, i",
  ï: "option+u, i",
  œ: "option+q",
  æ: "option+'",
  "«": "option+\\",
  "»": "option+shift+\\",
  "€": "option+shift+2",
};

/** Letters with their own key on the layout (layouts.ts of identity). */
const DIRECT: Partial<Record<KeyboardLayoutId, readonly GuideChar[]>> = {
  CSA: ["é", "è", "à", "ç", "ù"],
  FR_CA: ["é"],
  AZERTY: ["é", "è", "ç", "à", "ù"],
};

/** The dead key that makes each accent on a layout (circumflex `^`; diaeresis; grave; cedilla). */
const DEAD: Partial<
  Record<KeyboardLayoutId, Partial<Record<"circ" | "diaer" | "grave" | "cedil", string>>>
> = {
  CSA: { circ: "^", diaer: "shift+^" },
  FR_CA: { circ: "^", diaer: "shift+¸", grave: "`", cedil: "¸" },
  AZERTY: { circ: "^", diaer: "shift+^" },
};

const ACCENT: Partial<Record<GuideChar, "circ" | "diaer" | "grave" | "cedil">> = {
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

/** AltGr keys on Windows (the right Alt key). */
const ALTGR: Partial<Record<KeyboardLayoutId, Partial<Record<GuideChar, string>>>> = {
  CSA: { "«": "altgr+z", "»": "altgr+x" },
  AZERTY: { "€": "altgr+e" },
};

/** The layout's own key or dead key for a character, as a candidate, else undefined. */
function onLayout(layout: KeyboardLayoutId, char: GuideChar): GuideCombination | undefined {
  if (DIRECT[layout]?.includes(char)) return candidate(char);
  const accent = ACCENT[char];
  const dead = accent ? DEAD[layout]?.[accent] : undefined;
  return dead ? candidate(`${dead}, ${base(char)}`) : undefined;
}

/**
 * The real-machine checks (C27): char -> layout -> OS -> the log row's check id, with the keys as typed
 * when they differ from the candidate. The ONLY place a combination becomes shown. Empty: nothing has
 * been checked yet (work/log/999.md "Guide checks").
 */
export type GuideVerified = Partial<
  Record<
    GuideChar,
    Partial<Record<KeyboardLayoutId, Partial<Record<GuideOs, { check: string; keys?: string }>>>>
  >
>;
const VERIFIED: GuideVerified = {};

/** Applies the checks over the candidates (exported for the tests: a fake check shows its pair). */
export function withChecks(
  pairs: GuidePairs,
  char: GuideChar,
  verified: GuideVerified,
): GuidePairs {
  const out: GuidePairs = {};
  for (const [layout, byOs] of Object.entries(pairs) as [
    KeyboardLayoutId,
    Partial<Record<GuideOs, GuideCombination>>,
  ][]) {
    const row: Partial<Record<GuideOs, GuideCombination>> = {};
    for (const os of GUIDE_OSES) {
      const done = verified[char]?.[layout]?.[os];
      const filed = byOs[os];
      if (done)
        row[os] = {
          strokes: done.keys ? parseKeys(done.keys) : (filed?.strokes ?? []),
          check: done.check,
        };
      else if (filed) row[os] = filed;
    }
    out[layout] = row;
  }
  return out;
}

function candidatesFor(char: GuideChar): GuidePairs {
  const pairs: GuidePairs = {};
  for (const layout of GUIDE_LAYOUTS) {
    const own = onLayout(layout, char);
    const altGr = ALTGR[layout]?.[char];
    pairs[layout] = {
      windows: own ?? (altGr ? candidate(altGr) : altCode(char)),
      // macOS: only the U.S. source's Option keys and the layouts' own keys are filed as candidates
      ...(layout === "US_QWERTY"
        ? { mac: candidate(MAC_US[char]) }
        : own && layout !== "FR_CA"
          ? { mac: own }
          : {}),
      chromeos: own ?? (layout === "AZERTY" && altGr ? candidate(altGr) : unicode(char)),
    };
  }
  return pairs;
}

/**
 * Every entry, in the page's order. All combinations are candidates (`check: null`) until a real-machine
 * check is written in `work/log/999.md`: no Windows, macOS or ChromeOS machine was available to the build
 * (#999 M5a), and no committed macOS fixture exists on main. To verify one: type it on the machine, add a
 * "Guide checks" row to the log, then add its id to `VERIFIED` (with `keys` when the machine typed it
 * differently from the candidate).
 */
export const GUIDE_CONTENT: readonly GuideEntry[] = GUIDE_CHARS.map(({ char, anchor }) => ({
  char,
  anchor,
  pairs: withChecks(candidatesFor(char), char, VERIFIED),
}));

/** The combination the page shows for a pair: only a checked one (C27); a candidate reads as none. */
export function shownCombination(
  entry: GuideEntry,
  layout: KeyboardLayoutId,
  os: GuideOs,
): GuideCombination | null {
  const combination = entry.pairs[layout]?.[os];
  return combination?.check ? combination : null;
}

/** True when at least one character is verified for this layout and OS. */
export function pairVerified(
  content: readonly GuideEntry[],
  layout: KeyboardLayoutId,
  os: GuideOs,
): boolean {
  return content.some((entry) => shownCombination(entry, layout, os) !== null);
}
