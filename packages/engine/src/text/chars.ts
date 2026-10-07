/**
 * Characters of a normalised text. `Intl.Segmenter` is not allowed in the engine; after
 * `normalizeTypeable` every typeable character is one BMP code point, so this equals
 * `text.split("")` and `text[i]` indexes the same character (asserted in the tests).
 */
export function charsOf(text: string): string[] {
  return [...text];
}
