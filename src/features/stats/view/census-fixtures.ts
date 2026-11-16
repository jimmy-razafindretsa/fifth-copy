import { type Census, type CensusTypist, type CensusViewer, censusOf } from "./census";

/**
 * Typist census fixtures (#966 C7) for `/design` and component tests: built by `censusOf` from a
 * synthetic population, so they always follow its rules. No real typist's data; deterministic.
 */

const FIXTURE_SIZE = 160;

/** A bell-ish deviate for quantile `u` (logistic, close to a normal for display). */
const deviate = (u: number) => 0.55 * Math.log(u / (1 - u));

/** 160 synthetic typists: speeds around 52 WPM, accuracy around 93 %, the two shuffled apart. */
export const CENSUS_FIXTURE_POPULATION: readonly CensusTypist[] = Array.from(
  { length: FIXTURE_SIZE },
  (_, i) => {
    const speed = 52 + 18 * deviate((i + 0.5) / FIXTURE_SIZE);
    const accuracy = 0.93 + 0.03 * deviate((((i * 37) % FIXTURE_SIZE) + 0.5) / FIXTURE_SIZE);
    return {
      averageWpm: speed,
      bestWpm: speed * 1.18 + 4,
      averageAccuracy: accuracy,
      bestAccuracy: Math.min(1, accuracy + 0.025),
    };
  },
);

/** The fixture viewers: one in the middle, one at the top, one under 3 counted races. */
export const CENSUS_FIXTURE_VIEWERS = {
  middle: { averageWpm: 54.2, bestWpm: 68.9, averageAccuracy: 0.934, bestAccuracy: 0.961, races: 42 },
  top: { averageWpm: 118.4, bestWpm: 141.7, averageAccuracy: 0.991, bestAccuracy: 1, races: 310 },
  newcomer: { averageWpm: 31, bestWpm: 35, averageAccuracy: 0.88, bestAccuracy: 0.9, races: 2 },
} as const satisfies Record<string, NonNullable<CensusViewer>>;

export type CensusFixture = "underFloor" | "middle" | "top" | "newcomer";

export const censusFixtures: Record<CensusFixture, Census | null> = {
  underFloor: censusOf(CENSUS_FIXTURE_POPULATION.slice(0, 29), CENSUS_FIXTURE_VIEWERS.middle),
  middle: censusOf(CENSUS_FIXTURE_POPULATION, CENSUS_FIXTURE_VIEWERS.middle),
  top: censusOf(CENSUS_FIXTURE_POPULATION, CENSUS_FIXTURE_VIEWERS.top),
  newcomer: censusOf(CENSUS_FIXTURE_POPULATION, CENSUS_FIXTURE_VIEWERS.newcomer),
};
