/**
 * The dead-key fixture format (#566, spec 15, R179): what the recorder page (`/design/keys`) captures on a
 * real machine and the race input handler (#567) replays. Zod-free on purpose (#626): the recorder is a
 * client leaf, so the zod schema lives apart in `fixture.ts` and only tests and server code import it.
 * The ids double as the fixture file names: `fixtures/<os>-<layout>-<case>.json`.
 */

export const FIXTURE_OSES = ["windows", "macos", "chromeos"] as const;
export type FixtureOs = (typeof FIXTURE_OSES)[number];

/** Proper names, the same in both languages (bible 2: one language per block, names stay). */
export const FIXTURE_OS_NAMES: Record<FixtureOs, string> = {
  windows: "Windows",
  macos: "macOS",
  chromeos: "ChromeOS",
};

export const FIXTURE_BROWSERS = ["chrome", "edge", "firefox", "safari"] as const;
export type FixtureBrowser = (typeof FIXTURE_BROWSERS)[number];

export const FIXTURE_BROWSER_NAMES: Record<FixtureBrowser, string> = {
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
  safari: "Safari",
};

/** The four supported layouts (spec R179): CSA, French Canada, AZERTY, US QWERTY. */
export const FIXTURE_LAYOUTS = ["csa", "fr-ca", "azerty", "us"] as const;
export type FixtureLayout = (typeof FIXTURE_LAYOUTS)[number];

/** The accented cases and what each should commit. `option-combos` is the US QWERTY macOS Option keys. */
export const FIXTURE_CASES = {
  "circumflex-e": "ê",
  "c-cedilla": "ç",
  "e-acute": "é",
  "e-grave": "è",
  "u-grave": "ù",
  "oe-ligature": "œ",
  guillemets: "«»",
  "option-combos": "éêèçœ«»",
} as const;
export type FixtureCase = keyof typeof FIXTURE_CASES;
export const FIXTURE_CASE_IDS = Object.keys(FIXTURE_CASES) as FixtureCase[];

/** The six event types the race input listens to (ARCHITECTURE 7.3: a keystroke starts in the browser). */
export const KEY_EVENT_TYPES = [
  "keydown",
  "beforeinput",
  "input",
  "compositionstart",
  "compositionupdate",
  "compositionend",
] as const;
export type KeyEventType = (typeof KEY_EVENT_TYPES)[number];

/** One recorded event; a field the event type does not carry is `null` (never guessed). */
export type RecordedKeyEvent = {
  type: KeyEventType;
  key: string | null;
  code: string | null;
  isComposing: boolean | null;
  data: string | null;
  inputType: string | null;
};

export type KeyEventFixture = {
  os: FixtureOs;
  browser: FixtureBrowser;
  layout: FixtureLayout;
  case: FixtureCase;
  events: RecordedKeyEvent[];
  /** The text the input committed once the case was typed (what the handler must reproduce). */
  expected: string;
};

/** The file name a fixture is saved under. */
export function fixtureFileName(f: Pick<KeyEventFixture, "os" | "layout" | "case">): string {
  return `${f.os}-${f.layout}-${f.case}.json`;
}

const ACCENT_CASES = FIXTURE_CASE_IDS.filter((c) => c !== "option-combos");

/**
 * The minimum set C2 asserts: every accented case for CSA, French Canada and AZERTY on Windows and macOS,
 * plus the Option combos for US QWERTY on macOS (ChromeOS where a machine is available, not required).
 */
export const MINIMUM_FIXTURE_SET: string[] = [
  ...(["windows", "macos"] as const).flatMap((os) =>
    (["csa", "fr-ca", "azerty"] as const).flatMap((layout) =>
      ACCENT_CASES.map((c) => fixtureFileName({ os, layout, case: c })),
    ),
  ),
  fixtureFileName({ os: "macos", layout: "us", case: "option-combos" }),
];

/** Reads the fields the fixture keeps from a live DOM event (KeyboardEvent, InputEvent, CompositionEvent). */
export function recordKeyEvent(e: Event): RecordedKeyEvent | null {
  if (!(KEY_EVENT_TYPES as readonly string[]).includes(e.type)) return null;
  const v = e as Event & {
    key?: unknown;
    code?: unknown;
    isComposing?: unknown;
    data?: unknown;
    inputType?: unknown;
  };
  const str = (x: unknown) => (typeof x === "string" ? x : null);
  return {
    type: e.type as KeyEventType,
    key: str(v.key),
    code: str(v.code),
    isComposing: typeof v.isComposing === "boolean" ? v.isComposing : null,
    data: str(v.data),
    inputType: str(v.inputType),
  };
}

/** The fixture JSON the recorder copies (two-space indent, one trailing newline, ready to commit). */
export function fixtureJson(f: KeyEventFixture): string {
  return `${JSON.stringify(f, null, 2)}\n`;
}

/** A best guess of the recording machine from the user agent; the owner corrects it in the selects. */
export function guessMachine(ua: string): { os: FixtureOs; browser: FixtureBrowser } {
  const os: FixtureOs = /CrOS/.test(ua) ? "chromeos" : /Mac OS X|Macintosh/.test(ua) ? "macos" : "windows";
  const browser: FixtureBrowser = /Edg\//.test(ua)
    ? "edge"
    : /Firefox\//.test(ua)
      ? "firefox"
      : /Chrome\//.test(ua)
        ? "chrome"
        : /Safari\//.test(ua)
          ? "safari"
          : "chrome";
  return { os, browser };
}
