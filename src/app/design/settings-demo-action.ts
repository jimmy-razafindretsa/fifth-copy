"use server";

import type { UpdatePreferencesResult } from "@/features/identity";

/** The `/design` settings specimens' save (#66 C7): files nothing, answers as a filed change would. */
export async function fileSpecimenPreference(patch: unknown): Promise<UpdatePreferencesResult> {
  void patch;
  return {
    ok: true,
    preferences: { layout: null, theme: "SYSTEM", locale: "en", sound: true },
  };
}
