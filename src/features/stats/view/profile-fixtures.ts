import { buildProfile, type Profile, type ResultRow } from "./profile";

/**
 * Personnel file fixtures (#931 C5) for `/design` and component tests: built by `buildProfile` from
 * synthetic results at a fixed instant, so they always follow the definitions. No real typist's data.
 */
export const PROFILE_FIXTURE_NOW = new Date("2026-11-13T17:00:00Z");

const DAY_MS = 86_400_000;

/** A result `daysAgo` days before the fixture instant, `minutes` later in that day. */
const result = (
  daysAgo: number,
  cleanWpm: number,
  language: ResultRow["language"],
  accuracy: number,
  minutes = 0,
  place = 2,
  durationMs = 60_000,
): ResultRow => ({
  createdAt: new Date(
    PROFILE_FIXTURE_NOW.getTime() - daysAgo * DAY_MS - 3 * 3_600_000 + minutes * 60_000,
  ),
  cleanWpm,
  accuracy,
  language,
  durationMs,
  place,
});

/** Two weeks of a typist who races every day but one, in French and English, and speeds up. */
function twoWeeks(): ResultRow[] {
  const rows: ResultRow[] = [];
  for (let daysAgo = 13; daysAgo >= 0; daysAgo -= 1) {
    if (daysAgo === 9) continue;
    const step = 13 - daysAgo;
    // Wins every third day, a podium most days, a slower desk now and then.
    const place = step % 3 === 0 ? 1 : step % 4 === 0 ? 5 : 2 + (step % 2);
    rows.push(result(daysAgo, 31 + step * 1.6, "FR", 0.9 + step * 0.004, 0, place, 58_000));
    if (daysAgo % 2 === 0)
      rows.push(result(daysAgo, 27 + step * 1.3, "EN", 0.88 + step * 0.004, 20, 4, 61_500));
  }
  return rows;
}

export const profileFixtures = {
  /** No counted race yet: every figure empty. */
  "brand-new": buildProfile([], PROFILE_FIXTURE_NOW),
  /** A single race (#932): the service record's first line, a win. */
  "one-race": buildProfile([result(0, 42.3, "FR", 0.947, 0, 1, 47_200)], PROFILE_FIXTURE_NOW),
  /** Three races: a series and bests, no gain yet. */
  early: buildProfile(
    [result(2, 28.4, "FR", 0.91), result(1, 33.1, "FR", 0.93), result(0, 30.6, "EN", 0.89)],
    PROFILE_FIXTURE_NOW,
  ),
  /** Two weeks in both languages: gain, 7-day averages, a streak since the missed day. */
  "two-weeks": buildProfile(twoWeeks(), PROFILE_FIXTURE_NOW),
} satisfies Record<string, Profile>;

export type ProfileFixture = keyof typeof profileFixtures;
