/**
 * The keyboard layouts a student picks from (R179, ARCHITECTURE 8.4), as data: the single layout module
 * the typing machine (#224, bible 7.7a), the settings picker (#66), the machine skins (#638) and the
 * keyboard heatmap (#325) map onto. Pure data, no imports (client-safe on its own; reached from other
 * features only through `@/features/identity`).
 *
 * Each layout is three rows of keys, the letter rows from the back (the Q or A row) to the front, as the
 * unshifted key caps read in lower case, one character per key (the space bar is the machine's own).
 * Extension point: a new layout is its id in `keyboardLayoutIds` plus one entry in `layouts`.
 */

/** Every layout id; the preference (#66) parses against this list. */
export const keyboardLayoutIds = ["CSA", "FR_CA", "US_QWERTY", "AZERTY"] as const;
export type KeyboardLayoutId = (typeof keyboardLayoutIds)[number];

/**
 * - `CSA`: Canadian Multilingual Standard (CAN/CSA Z243.200-92), the 105-key board: `^` (dead
 *   circumflex) and `ç` after P, `è` and `à` after the semicolon, `ù` left of Z, `é` after the period.
 * - `FR_CA`: Canadian French (CA-FR, "French (Canada)" on Windows and ChromeOS), the 104-key board: `<`
 *   ends the top row and `é` the bottom one. Its cedilla and grave keys are dead keys: the race never sees
 *   them (`RaceInput` drops `Dead`) but the letter they make, so their caps read that letter, `ç` and `è`
 *   (a French typist's main use of each); the circumflex keeps `^`, as on CSA.
 * - `US_QWERTY`: US English, the 104-key board (`\` ends the top row).
 * - `AZERTY`: French (France), the 105-key board: `^` (dead) and `$` after P, `m`, `ù` and `*` on the
 *   home row, `<` left of W.
 */
export const layouts: Record<KeyboardLayoutId, readonly (readonly string[])[]> = {
  CSA: [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "^", "ç"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "è", "à"],
    ["ù", "z", "x", "c", "v", "b", "n", "m", ",", ".", "é"],
  ],
  FR_CA: [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "^", "ç", "<"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "è"],
    ["z", "x", "c", "v", "b", "n", "m", ",", ".", "é"],
  ],
  US_QWERTY: [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", "\\"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'"],
    ["z", "x", "c", "v", "b", "n", "m", ",", ".", "/"],
  ],
  AZERTY: [
    ["a", "z", "e", "r", "t", "y", "u", "i", "o", "p", "^", "$"],
    ["q", "s", "d", "f", "g", "h", "j", "k", "l", "m", "ù", "*"],
    ["<", "w", "x", "c", "v", "b", "n", ",", ";", ":", "!"],
  ],
};
