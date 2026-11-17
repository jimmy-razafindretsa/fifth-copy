import type { Locale } from "./locale";

/** Fills `{name}` placeholders of a catalog template (ADR 0010: no i18n library). */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * `OFFICIER` -> `Officier`, `HERO OF PAPERWORK` -> `Hero of paperwork`: the spoken form of an all-caps
 * catalog label such as a rank name (#337 ladder, #969 header grade).
 */
export function spokenRank(name: string, locale: Locale): string {
  const lower = name.toLocaleLowerCase(locale);
  return lower.charAt(0).toLocaleUpperCase(locale) + lower.slice(1);
}
