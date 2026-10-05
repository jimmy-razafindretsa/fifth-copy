import "server-only";
import { cookies, headers } from "next/headers";
import { en } from "./en";
import { fr } from "./fr";
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  localeFromAcceptLanguage,
  type Locale,
} from "./locale";

export type { Messages } from "./en";
export { fill } from "./format";
export { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, LOCALES, type Locale } from "./locale";

const catalogs = { en, fr } as const;

/**
 * The request's UI language (ADR 0010): the `locale` cookie set by the header toggle, else the browser's
 * `Accept-Language`, else English. Reading cookies makes the page render per request, by design.
 */
export async function getLocale(): Promise<Locale> {
  const jar = await cookies();
  const fromCookie = jar.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  const accept = (await headers()).get("accept-language");
  return localeFromAcceptLanguage(accept) ?? DEFAULT_LOCALE;
}

/** Server-side catalog lookup (ADR 0010). Client leaves receive the strings they need as props. */
export async function getT() {
  return catalogs[await getLocale()];
}
