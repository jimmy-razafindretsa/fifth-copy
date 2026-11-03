import { expect, it } from "vitest";
import { normalizeUsername } from "./username";

it("folds case, width and surrounding space into one canonical form", () => {
  for (const typed of ["Ada", "ada", " ADA ", "Ａda"]) expect(normalizeUsername(typed)).toBe("ada");
});

it("keeps inner characters", () => {
  expect(normalizeUsername("Ada Lovelace-1")).toBe("ada lovelace-1");
});
