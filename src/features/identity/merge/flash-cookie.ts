import type { MergeCounts } from "./merge-guest";

// The one-shot merge flash (#57): after a guest merge (ADR 0009) the caller leaves the number of races
// carried in the `fc_merged` cookie; the next render shows the merge stamp and the browser clears the
// cookie at once. The value is a count, nothing personal, so a script may read and clear it. Pure: the
// server setter is ./flash.ts, the client clear is `clearMergedFlash`.

export const MERGED_COOKIE = "fc_merged";
/** Seconds the flash survives unread: the merge callers redirect at once, a minute is plenty. */
export const MERGED_COOKIE_MAX_AGE = 60;
const MAX_RACES = 1_000_000;

/** The races carried, or null for a missing or forged value (digits only, at most 1,000,000). */
export function parseMergedFlash(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,7}$/.test(value)) return null;
  const n = Number(value);
  return n <= MAX_RACES ? n : null;
}

/** The races a merge carried: the guest's race results moved to the account. */
export function mergedRaces(counts: MergeCounts): number {
  return counts.RaceResult ?? 0;
}

/** The catalog plural form for `n` races (EN and FR both have a zero, a one and an other form). */
export function mergePluralForm(n: number): "zero" | "one" | "other" {
  return n === 0 ? "zero" : n === 1 ? "one" : "other";
}

/** Clears the flash in the browser (the stamp's first effect): it is shown once. */
export function clearMergedFlash(): void {
  document.cookie = `${MERGED_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}
