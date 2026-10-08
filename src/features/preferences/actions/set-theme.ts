"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { preferenceCookieOptions } from "../cookie";
import { themeChoiceSchema } from "../schema";
import { THEME_COOKIE } from "../theme";

/**
 * The header's NIGHT SHIFT toggle: validates, writes the `theme` cookie, re-renders the tree. Accepts
 * the toggle's form data (works before hydration) or a bare choice. `system` deletes the cookie so
 * the OS decides again (tokens.css `prefers-color-scheme`); #66 uses it to mirror the account setting.
 */
export async function setTheme(input: FormData | string): Promise<void> {
  const choice = themeChoiceSchema.parse(input instanceof FormData ? input.get("theme") : input);
  const jar = await cookies();
  if (choice === "system") jar.delete(THEME_COOKIE);
  else jar.set(THEME_COOKIE, choice, preferenceCookieOptions());
  revalidatePath("/", "layout");
}
