"use client";

import { useOptimistic, useSyncExternalStore } from "react";
import { setTheme } from "../actions/set-theme";
import type { Theme } from "../theme";
import styles from "./toggles.module.css";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToScheme(onChange: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

const systemTheme = (): Theme => (window.matchMedia(DARK_QUERY).matches ? "dark" : "light");
const other = (theme: Theme): Theme => (theme === "dark" ? "light" : "dark");

/**
 * NIGHT SHIFT toggle (bible 14.1): gold dot when the night theme is on. A form whose hidden field
 * carries the next theme, so it works before hydration. With no cookie the page follows the OS, so the
 * pressed state reads the media query after hydration. A click switches `data-theme` on `<html>` at
 * once (tokens.css) and the server action persists the choice.
 */
export function ThemeToggle({ theme, label }: { theme: Theme | null; label: string }) {
  const system = useSyncExternalStore(subscribeToScheme, systemTheme, () => "light" as Theme);
  const [effective, show] = useOptimistic<Theme, Theme>(theme ?? system, (_, next) => next);
  const next = other(effective);

  const choose = async (form: FormData) => {
    show(next);
    document.documentElement.dataset.theme = next;
    await setTheme(form);
  };

  return (
    <form action={choose} className="contents">
      <input type="hidden" name="theme" value={next} />
      <button type="submit" aria-pressed={effective === "dark"} className={styles.night}>
        <span aria-hidden="true" className={styles.dot} />
        {label}
      </button>
    </form>
  );
}
