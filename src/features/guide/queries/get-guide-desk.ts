import "server-only";
import { headers } from "next/headers";
import { getPreferences, getViewer, localeLayouts } from "@/features/identity";
import { getLocale } from "@/i18n";
import type { GuideDesk } from "../components/guide-view";
import { GUIDE_LAYOUTS } from "../content";
import { detectOs, parseOs } from "../os";

/**
 * The guide's desk (#999 C26): the layout from `?layout=`, else the viewer's saved layout, else the
 * locale's default (as the race machine and the keyboard map); the OS from `?os=` (chosen), else the
 * request (detected), else none (the unknown-OS fallback). Reads only; creates no guest (ADR 0009).
 */
export async function getGuideDesk(params: { layout?: unknown; os?: unknown }): Promise<GuideDesk> {
  const [viewer, locale, requestHeaders] = await Promise.all([getViewer(), getLocale(), headers()]);
  const asked = GUIDE_LAYOUTS.find((id) => id === params.layout);
  const layout = asked ?? (await getPreferences(viewer)).layout ?? localeLayouts[locale];
  const chosen = parseOs(params.os);
  if (chosen) return { layout, os: chosen, osSource: "chosen" };
  const detected = detectOs(
    requestHeaders.get("user-agent"),
    requestHeaders.get("sec-ch-ua-platform"),
  );
  return { layout, os: detected, osSource: detected ? "detected" : null };
}
