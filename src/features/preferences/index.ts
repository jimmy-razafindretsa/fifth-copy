export { setLocale } from "./actions/set-locale";
export { setTheme } from "./actions/set-theme";
export { LocaleToggle } from "./components/locale-toggle";
export { ThemeToggle } from "./components/theme-toggle";
// the cookie options the settings save (#66) mirrors theme and locale with
export { preferenceCookieOptions } from "./cookie";
export { getTheme } from "./queries/get-theme";
export {
  isTheme,
  THEME_CHOICES,
  THEME_COOKIE,
  THEMES,
  type Theme,
  type ThemeChoice,
} from "./theme";
