import "server-only";
import { cookies } from "next/headers";
import { isTheme, THEME_COOKIE, type Theme } from "../theme";

/** The explicit theme choice, or null to follow the OS (tokens.css `prefers-color-scheme`). */
export async function getTheme(): Promise<Theme | null> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(value) ? value : null;
}
