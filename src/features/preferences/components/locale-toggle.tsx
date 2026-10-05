"use client";

import { useOptimistic } from "react";
import { isLocale, LOCALES, type Locale } from "@/i18n/locale";
import { setLocale } from "../actions/set-locale";
import styles from "./toggles.module.css";

/**
 * EN | FR segmented toggle (bible 7.1): a form whose two submit buttons carry the locale, so it works
 * before hydration too. Once hydrated the pressed segment follows the choice at once and the server
 * action re-renders the page in the new language (ADR 0010).
 */
export function LocaleToggle({ locale, label }: { locale: Locale; label: string }) {
  const [shown, show] = useOptimistic(locale);

  const choose = async (form: FormData) => {
    const next = form.get("locale");
    if (!isLocale(next) || next === shown) return;
    show(next);
    await setLocale(form);
  };

  return (
    <form action={choose} role="group" aria-label={label} className={styles.segmented}>
      {LOCALES.map((option) => (
        <button
          key={option}
          type="submit"
          name="locale"
          value={option}
          lang={option}
          aria-pressed={shown === option}
          className={styles.segment}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </form>
  );
}
