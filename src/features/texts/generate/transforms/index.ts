import { accentsTransform } from "./accents";
import { numbersTransform, punctuationTransform, symbolsTransform } from "./include-toggles";
import { practiceLettersTransform } from "./practice-letters";
import { profanityTransform } from "./profanity-pass";
import type { Transform } from "./types";

export type { Transform } from "./types";

/**
 * The character-level controls (#354), applied in this order after the strategy and before the count
 * fix-up. Extension point: a new control is one transform here. Accents come before practice letters
 * (whose swaps keep the accent rule); the include toggles follow; the profanity pass is always last.
 */
export const TRANSFORMS: readonly Transform[] = [
  accentsTransform,
  practiceLettersTransform,
  punctuationTransform,
  numbersTransform,
  symbolsTransform,
  profanityTransform,
];
