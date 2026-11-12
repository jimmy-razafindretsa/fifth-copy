import type { Rng } from "@fifth-copy/engine";
import type { RaceSettings } from "@fifth-copy/protocol";
import type { Lists } from "../tokens";

/**
 * One character-level control (#354): a pure function from the strategy's tokens to new tokens. It
 * never adds a word; it may drop one (the count fix-up of `generate.ts` refills the text).
 */
export type Transform = (
  tokens: readonly string[],
  settings: RaceSettings,
  rng: Rng,
  lists: Lists,
) => string[];
