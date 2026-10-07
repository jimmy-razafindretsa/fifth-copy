/** Theme constants shared by the server (root layout) and the header toggle (ARCHITECTURE 8.4). */
export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
/** `setTheme` inputs: the two themes, or `system` (no cookie: follow `prefers-color-scheme`). */
export const THEME_CHOICES = [...THEMES, "system"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];
/** The cookie the NIGHT SHIFT toggle writes; absent = follow the OS (`prefers-color-scheme`). */
export const THEME_COOKIE = "theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}
