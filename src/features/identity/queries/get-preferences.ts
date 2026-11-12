import "server-only";
import { getLocale } from "@/i18n";
import type { Viewer } from "@/server/auth";
import { db } from "@/server/db";
import { DEFAULT_MACHINE_SKIN, machineSkinSchema, type Preferences } from "../schema";

/**
 * The viewer's settings (#66 C2). No viewer or no row reads the defaults: no layout chosen, the system
 * theme, sound off (#243: muted by default, for classrooms), and the request's locale (the `locale` cookie, then `Accept-Language`, ADR 0010).
 * A stored locale wins over the cookie. A stored machine skin no longer registered reads the default (#638).
 */
export async function getPreferences(viewer: Viewer | null): Promise<Preferences> {
  const row = viewer
    ? await db.preference.findUnique({
        where: { userId: viewer.id },
        select: { layout: true, theme: true, locale: true, sound: true, machineSkin: true },
      })
    : null;
  return {
    layout: row?.layout ?? null,
    theme: row?.theme ?? "SYSTEM",
    locale: row?.locale ? (row.locale === "FR" ? "fr" : "en") : await getLocale(),
    sound: row?.sound ?? false,
    machineSkin: machineSkinSchema.catch(DEFAULT_MACHINE_SKIN).parse(row?.machineSkin),
  };
}
