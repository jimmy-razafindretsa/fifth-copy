import "server-only";
import { cookies } from "next/headers";
import { preferenceCookieOptions, THEME_COOKIE } from "@/features/preferences";
import { LOCALE_COOKIE, type Locale } from "@/i18n/locale";
import { db } from "@/server/db";
import { logger } from "@/server/logger";
import type { PreferenceTheme } from "../schema";

/**
 * Mirrors theme and locale to the cookies the root layout reads (#66 C3, ADR 0010, ARCHITECTURE 8.4), so
 * a page renders `data-theme` and `<html lang>` without a database read. `SYSTEM` deletes the theme
 * cookie (the page follows `prefers-color-scheme`, as the header's `setTheme("system")`). A key left
 * out leaves its cookie alone.
 */
export async function writePreferenceCookies(values: {
  theme?: PreferenceTheme;
  locale?: Locale;
}): Promise<void> {
  const jar = await cookies();
  if (values.theme === "SYSTEM") jar.delete(THEME_COOKIE);
  else if (values.theme)
    jar.set(THEME_COOKIE, values.theme.toLowerCase(), preferenceCookieOptions());
  if (values.locale) jar.set(LOCALE_COOKIE, values.locale, preferenceCookieOptions());
}

/**
 * After sign-in (#66 C3): the account's stored theme and locale replace the browser's cookies (the
 * database wins). No row, or no stored locale, keeps what the browser has. Never fails the sign-in: a
 * read that throws is logged by name only.
 */
export async function refreshPreferenceCookies(userId: string): Promise<void> {
  try {
    const row = await db.preference.findUnique({
      where: { userId },
      select: { theme: true, locale: true },
    });
    if (!row) return;
    await writePreferenceCookies({
      theme: row.theme,
      locale: row.locale === null ? undefined : row.locale === "FR" ? "fr" : "en",
    });
  } catch (error) {
    logger.warn("preference cookie refresh failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}
