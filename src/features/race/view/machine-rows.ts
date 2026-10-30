"use server";

import { z } from "zod";
import type { KeyboardLayoutId } from "@/features/identity";
import { LOCALES, type Locale } from "@/i18n/locale";

/** The keys of the typing machine, row by row (`TypingMachine`'s `rows`, bible 7.7a). */
type Rows = readonly (readonly string[])[];

/** Without a saved layout the UI language picks one (ADR 0010: the race language stays independent). */
const BY_LOCALE: Record<Locale, KeyboardLayoutId> = { fr: "CSA", en: "US_QWERTY" };

/**
 * The machine's rows for a viewer (#224 C2, R179): `layout` is the viewer's saved keyboard layout, `null`
 * until the settings screen (#66) stores one, then `locale` (the request's UI language) chooses:
 * French -> CSA, English -> US QWERTY. The data lives in identity (`layouts`, ARCHITECTURE 8.2); this is
 * the race's only module that reads it, and only the race page calls it (#66 replaces its `null` with
 * the saved layout; nothing else in the race feature changes).
 *
 * A `"use server"` module on purpose, like `getRaceSeat`: the race index is imported by client modules
 * (the lobby's lazy socket import, `/design`), the identity barrel is server-only at runtime, and only a
 * server function reaches a client graph as a mere reference. Its result is public data the page itself
 * renders; the input is parsed all the same. Identity loads on the first call, so importing the race index
 * (unit tests, the server graph) needs no environment.
 */
export async function machineRows(input: {
  layout: KeyboardLayoutId | null;
  locale: Locale;
}): Promise<Rows> {
  const { keyboardLayoutIds, layouts } = await import("@/features/identity");
  const { layout, locale } = z
    .strictObject({ layout: z.enum(keyboardLayoutIds).nullable(), locale: z.enum(LOCALES) })
    .parse(input);
  return layouts[layout ?? BY_LOCALE[locale]];
}
