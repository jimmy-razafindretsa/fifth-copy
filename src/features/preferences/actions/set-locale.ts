"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE } from "@/i18n/locale";
import { preferenceCookieOptions } from "../cookie";
import { localeSchema } from "../schema";

/**
 * The header's EN/FR toggle (ADR 0010): validates, writes the `locale` cookie, re-renders the tree.
 * Accepts the toggle's form data (works before hydration) or a bare locale.
 */
export async function setLocale(input: FormData | string): Promise<void> {
  const locale = localeSchema.parse(input instanceof FormData ? input.get("locale") : input);
  (await cookies()).set(LOCALE_COOKIE, locale, preferenceCookieOptions());
  revalidatePath("/", "layout");
}
