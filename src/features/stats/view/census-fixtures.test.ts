import { describe, expect, it } from "vitest";
import { CENSUS_MIN_POPULATION, censusOf } from "./census";
import {
  CENSUS_FIXTURE_POPULATION,
  CENSUS_FIXTURE_VIEWERS,
  censusFixtures,
} from "./census-fixtures";

// #966 C7: the census fixtures for `/design` and component tests are built by `censusOf`.

describe("censusFixtures (C7)", () => {
  it("names the four states", () => {
    expect(Object.keys(censusFixtures).sort()).toEqual(["middle", "newcomer", "top", "underFloor"]);
  });

  it("under the floor is null", () => {
    expect(censusFixtures.underFloor).toBeNull();
  });

  it("each fixture is censusOf over the synthetic population", () => {
    expect(CENSUS_FIXTURE_POPULATION.length).toBeGreaterThanOrEqual(CENSUS_MIN_POPULATION);
    expect(censusFixtures.middle).toEqual(
      censusOf(CENSUS_FIXTURE_POPULATION, CENSUS_FIXTURE_VIEWERS.middle),
    );
    expect(censusFixtures.top).toEqual(censusOf(CENSUS_FIXTURE_POPULATION, CENSUS_FIXTURE_VIEWERS.top));
    expect(censusFixtures.newcomer).toEqual(
      censusOf(CENSUS_FIXTURE_POPULATION, CENSUS_FIXTURE_VIEWERS.newcomer),
    );
  });

  it("the middle viewer sits mid-population, the top viewer near the top, the newcomer nowhere", () => {
    const middle = censusFixtures.middle!.averageSpeed.percentile!;
    expect(middle).toBeGreaterThan(30);
    expect(middle).toBeLessThan(70);
    const top = censusFixtures.top!;
    for (const d of [top.averageSpeed, top.bestSpeed, top.averageAccuracy, top.bestAccuracy]) {
      expect(d.percentile!).toBeGreaterThan(90);
      expect(d.percentile!).toBeLessThan(100);
    }
    expect(censusFixtures.newcomer!.averageSpeed.value).toBeNull();
    expect(censusFixtures.newcomer!.averageSpeed.percentile).toBeNull();
  });
});
