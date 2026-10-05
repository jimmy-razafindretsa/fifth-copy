import { z } from "zod";
import { LOCALES } from "@/i18n/locale";
import { THEMES } from "./theme";

export const localeSchema = z.enum(LOCALES);
export const themeSchema = z.enum(THEMES);
