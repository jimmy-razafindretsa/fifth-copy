/**
 * Locale constants shared by the server (`getT`) and client leaves (ADR 0010). No `server-only` here.
 */
export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
/** The cookie the header toggle writes (ADR 0010: the locale is never a URL segment). */
export const LOCALE_COOKIE = "locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The first supported language of an `Accept-Language` header, or null. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase().split("-")[0];
    if (isLocale(tag)) return tag;
  }
  return null;
}
