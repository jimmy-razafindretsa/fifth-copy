"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/server/auth";
import { db } from "@/server/db";
import { throttledMessage, throttleGuestCreate } from "../auth/throttle";
import { getPreferences } from "../queries/get-preferences";
import { writePreferenceCookies } from "../preferences/cookies";
import { preferencesPatch, type Preferences } from "../schema";
import { ensureGuest } from "./ensure-guest";

export type UpdatePreferencesResult =
  | { ok: true; preferences: Preferences }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "rate-limited"; message: string };
/** The action's type, for the settings controls (client leaves receive it as a prop). */
export type UpdatePreferences = (patch: unknown) => Promise<UpdatePreferencesResult>;

/**
 * Saves part of the viewer's settings (#66 C1, C3). The patch is parsed first (unknown keys refused);
 * a visitor without an identity gets a guest (`ensureGuest`, ADR 0009: this save is the write that
 * needs one). The `Preference` row of the viewer is upserted, never another user's; theme and locale
 * are mirrored to their cookies and the layout re-renders, so `data-theme`, `<html lang>` and the
 * strings follow without a reload. Minting that guest spends the client IP's `guest-create` budget
 * first (#840, ADR 0020); over it the save is refused with the generic throttle line, nothing written.
 */
export async function updatePreferences(patch: unknown): Promise<UpdatePreferencesResult> {
  const parsed = preferencesPatch.safeParse(patch);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  let viewer = await getViewer();
  if (!viewer) {
    const verdict = await throttleGuestCreate();
    if (!verdict.ok) {
      return {
        ok: false,
        reason: "rate-limited",
        message: await throttledMessage(verdict.retryAfterMs),
      };
    }
    viewer = await ensureGuest();
  }
  const { locale, ...rest } = parsed.data;
  const data = {
    ...rest,
    ...(locale === undefined
      ? {}
      : { locale: locale === "fr" ? ("FR" as const) : ("EN" as const) }),
  };
  await db.preference.upsert({
    where: { userId: viewer.id },
    // a first row starts muted (#243) whatever the column's default: sound is opt-in for classrooms
    create: { userId: viewer.id, sound: false, ...data },
    update: data,
  });
  await writePreferenceCookies({ theme: parsed.data.theme, locale });
  revalidatePath("/", "layout");
  return { ok: true, preferences: await getPreferences(viewer) };
}
