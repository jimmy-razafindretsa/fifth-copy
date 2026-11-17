// The preference values the settings screen's client components read (#986): plain constants, no zod and
// no node:crypto, so a "use client" picker never pulls `../schema` (zod and the crypto polyfill its reset
// code helpers bring) into the first-load JS. `../schema` re-exports them and builds the patch from them.

/** The stored theme choice (`Preference.theme`); `SYSTEM` follows `prefers-color-scheme`. */
export const PREFERENCE_THEMES = ["LIGHT", "DARK", "SYSTEM"] as const;
export type PreferenceTheme = (typeof PREFERENCE_THEMES)[number];

/**
 * The seat-view machine skins a viewer may pick (#638, bible 7.7a): identity's own list, kept equal to the
 * race feature's `machineSkinIds` by `preferences.test.ts` (a new skin is registered there, then here).
 * `teleprinter` is the default and the column's default.
 */
export const PREFERENCE_MACHINE_SKINS = ["teleprinter"] as const;
export type PreferenceMachineSkin = (typeof PREFERENCE_MACHINE_SKINS)[number];
export const DEFAULT_MACHINE_SKIN: PreferenceMachineSkin = "teleprinter";

/**
 * The daily goal in minutes (#968, bible 14.3 "Settings"): the attendance register shades each day against
 * it. 5 to 60 in steps of 5; 15 is the column's default and the read of a viewer with no row.
 */
export const DAILY_GOAL_MIN = 5;
export const DAILY_GOAL_MAX = 60;
export const DAILY_GOAL_STEP = 5;
export const DEFAULT_DAILY_GOAL = 15;
