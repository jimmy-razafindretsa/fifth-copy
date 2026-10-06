"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { preferenceCookieOptions } from "../cookie";
import { themeSchema } from "../schema";
import { THEME_COOKIE } from "../theme";

/**
 * The header's NIGHT SHIFT toggle: validates, writes the `theme` cookie, re-renders the tree. Accepts
 * the toggle's form data (works before hydration) or a bare theme.
 */
export async function setTheme(input: FormData | string): Promise<void> {
  const theme = themeSchema.parse(input instanceof FormData ? input.get("theme") : input);
  (await cookies()).set(THEME_COOKIE, theme, preferenceCookieOptions());
  revalidatePath("/", "layout");
}
