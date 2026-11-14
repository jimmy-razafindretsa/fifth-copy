import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { docketRank } from "./docket-rank";

// The stats index reaches src/env.ts through its queries; the scale needs no secrets.
vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));

// #945 C1, C2, C3, C7: the docket's rank from the mean, named from the catalogs' rank list.
describe("docketRank", () => {
  it("51.4 reads OFFICER on the way to COMMISSAR at 70", () => {
    expect(docketRank(51.4, en.landing.clerk.ranks)).toMatchObject({
      level: "officer",
      name: "OFFICER",
      meanWpm: 51.4,
      next: { name: "COMMISSAR", at: 70 },
    });
  });

  it("no race reads RECRUIT on the way to CLERK at 35", () => {
    expect(docketRank(null, en.landing.clerk.ranks)).toMatchObject({
      name: "RECRUIT",
      meanWpm: 0,
      next: { name: "CLERK", at: 35, progress: 0 },
    });
  });

  it("90 and above is HERO OF PAPERWORK with no next rank", () => {
    expect(docketRank(90, en.landing.clerk.ranks)).toMatchObject({
      name: "HERO OF PAPERWORK",
      next: null,
    });
  });

  it("French names come from the French rank list", () => {
    expect(docketRank(51.4, fr.landing.clerk.ranks)).toMatchObject({
      name: "OFFICIER",
      next: { name: "COMMISSAIRE" },
    });
  });
});
