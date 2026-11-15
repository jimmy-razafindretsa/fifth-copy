import { useSyncExternalStore } from "react";

/** Whether this device is a Mac (Option, ⌥) or not (Alt), read once in the browser; `false` on the server. */
export function isMacPlatform(nav: { platform?: string; userAgent?: string } | undefined): boolean {
  if (!nav) return false;
  return /Mac|iPhone|iPad/i.test(nav.platform ?? "") || /Macintosh/i.test(nav.userAgent ?? "");
}

/** The play shortcut as the keyboard prints it (#951): `⌥ K` on a Mac, `Alt+K` elsewhere. */
export function shortcutLabel(key: string, mac: boolean): string {
  return mac ? `⌥ ${key}` : `Alt+${key}`;
}

const noSubscribe = () => () => {};

/** This device's shortcut label for `key`, `null` without one (the server reads Alt). */
export function useShortcutLabel(key: string | null): string | null {
  const mac = useSyncExternalStore(
    noSubscribe,
    () => isMacPlatform(typeof navigator === "undefined" ? undefined : navigator),
    () => false,
  );
  return key === null ? null : shortcutLabel(key, mac);
}
