import type { Messages } from "@/i18n";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import type { KeyboardMapKey } from "./keyboard-map";
import { NBSP, oneDecimal } from "./profile-figures";

export type KeyboardMapLabels = Messages["profile"]["keyboardMap"];

/**
 * A key's accessible name (#324 C6): `E : 14,7 % des frappes, 2,1 % de fautes`, or untyped. Pure, so
 * both the client keyboard map and the server accents row (#999 C55) name their keys with it.
 */
export function keyName(key: KeyboardMapKey, labels: KeyboardMapLabels, locale: Locale): string {
  if (!key.typed || key.errorRate === null) return fill(labels.untyped, { key: key.cap });
  return fill(labels.key, {
    key: key.cap,
    strokes: `${oneDecimal(key.ofStrokes * 100, locale)}${NBSP}%`,
    errors: `${oneDecimal(key.errorRate * 100, locale)}${NBSP}%`,
  });
}
