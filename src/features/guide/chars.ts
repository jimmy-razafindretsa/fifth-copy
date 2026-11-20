/**
 * The characters the "How to type it" guide (#999 C26, spec 14) files, in the page's order, each with its
 * deep-link anchor (`#c-cedilla` style). Pure data, no imports: the light client door (`client.ts`) hands
 * `guideHref` to the Personnel file's keyboard map (C29) without the guide's page or content.
 */
export const GUIDE_PATH = "/guide";

export const GUIDE_CHARS = [
  { char: "é", anchor: "e-acute" },
  { char: "è", anchor: "e-grave" },
  { char: "ê", anchor: "e-circumflex" },
  { char: "ë", anchor: "e-diaeresis" },
  { char: "à", anchor: "a-grave" },
  { char: "â", anchor: "a-circumflex" },
  { char: "ç", anchor: "c-cedilla" },
  { char: "ù", anchor: "u-grave" },
  { char: "û", anchor: "u-circumflex" },
  { char: "ô", anchor: "o-circumflex" },
  { char: "î", anchor: "i-circumflex" },
  { char: "ï", anchor: "i-diaeresis" },
  { char: "œ", anchor: "oe-ligature" },
  { char: "æ", anchor: "ae-ligature" },
  { char: "«", anchor: "guillemet-open" },
  { char: "»", anchor: "guillemet-close" },
  { char: "€", anchor: "euro" },
] as const;

export type GuideChar = (typeof GUIDE_CHARS)[number]["char"];
export type GuideAnchor = (typeof GUIDE_CHARS)[number]["anchor"];

const byChar = new Map<string, GuideAnchor>(GUIDE_CHARS.map((c) => [c.char, c.anchor]));

/** The guide's anchor for a character (either case: `Ç` is `c-cedilla`), or null when it has no entry. */
export function guideAnchor(char: string): GuideAnchor | null {
  return byChar.get(char) ?? byChar.get(char.toLowerCase()) ?? null;
}

/** `/guide#c-cedilla` for a character the guide files, else null (a plain letter has no entry). */
export function guideHref(char: string): string | null {
  const anchor = guideAnchor(char);
  return anchor ? `${GUIDE_PATH}#${anchor}` : null;
}
