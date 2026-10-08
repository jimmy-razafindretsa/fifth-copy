import { z } from "zod";
import { LOCALES } from "@/i18n/locale";
import { THEME_CHOICES, THEMES } from "./theme";

export const localeSchema = z.enum(LOCALES);
/** A stored theme (the cookie value). */
export const themeSchema = z.enum(THEMES);
/** What `setTheme` accepts: a theme, or `system` to delete the cookie and follow the OS (#66 mirrors it). */
export const themeChoiceSchema = z.enum(THEME_CHOICES);
