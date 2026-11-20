import { GUIDE_OSES, type GuideOs } from "./content";

/**
 * The reader's OS, from the request (#999 C26): the User-Agent (reduced UAs still name the platform:
 * `CrOS`, `Windows NT`, `Macintosh`), else the `Sec-CH-UA-Platform` client hint. iPads that say
 * `Macintosh` without touch cannot be told apart here and read as macOS;
 * anything else (Linux, Android, iOS, a bot, no header) is unknown: the page shows every OS for the
 * layout and asks the reader to pick (the unknown-OS fallback).
 */
export function detectOs(userAgent: string | null, platformHint: string | null): GuideOs | null {
  const ua = userAgent ?? "";
  if (/\bCrOS\b/.test(ua)) return "chromeos";
  if (/\bWindows NT\b/.test(ua)) return "windows";
  if (/\bMacintosh\b/.test(ua) && !/\b(iPhone|iPad|iPod)\b/.test(ua)) return "mac";
  const hint = platformHint?.replaceAll('"', "").trim().toLowerCase();
  if (hint === "windows") return "windows";
  if (hint === "macos") return "mac";
  if (hint === "chrome os" || hint === "chromeos") return "chromeos";
  return null;
}

/** A `?os=` override, else null (an unknown value is ignored, never trusted as markup). */
export function parseOs(value: unknown): GuideOs | null {
  return typeof value === "string" && (GUIDE_OSES as readonly string[]).includes(value)
    ? (value as GuideOs)
    : null;
}
