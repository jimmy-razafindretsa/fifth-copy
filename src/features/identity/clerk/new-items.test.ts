import { describe, expect, it } from "vitest";
import { OUTFIT_CATALOGUE, type OutfitCategory } from "./outfit";
import { NEW_ITEMS, parseSeen, serializeSeen, unseenNewItems } from "./new-items";

// #943 C28, C29: the NEW list names catalogue items; the seen cookie is ids of that list only.
describe("NEW items (#943 C28)", () => {
  it("names the bible's two NEW items", () => {
    expect([...NEW_ITEMS]).toEqual(["glasses:square", "hat:kepka"]);
  });

  it("every id is in the catalogue", () => {
    for (const key of NEW_ITEMS) {
      const [category, id] = key.split(":") as [OutfitCategory, string];
      expect(OUTFIT_CATALOGUE[category] as readonly string[], key).toContain(id);
    }
  });
});

describe("the seen cookie (#943 C29)", () => {
  it.each([
    [undefined, []],
    ["", []],
    ["glasses:square", ["glasses:square"]],
    ["hat:kepka,glasses:square", ["glasses:square", "hat:kepka"]],
    ["glasses:square,evil", []],
    ["hat:kepka,hat:kepka,hat:kepka", []],
    ["<script>", []],
    ["hair:side", []],
  ])("%j -> %j", (value, seen) => {
    expect(parseSeen(value)).toEqual(seen);
  });

  it("serializes in list order and round-trips", () => {
    expect(serializeSeen(["hat:kepka", "glasses:square"])).toBe("glasses:square,hat:kepka");
    expect(parseSeen(serializeSeen([...NEW_ITEMS]))).toEqual([...NEW_ITEMS]);
  });

  it("unseen = the list minus the seen ids", () => {
    expect(unseenNewItems([])).toEqual([...NEW_ITEMS]);
    expect(unseenNewItems(["hat:kepka"])).toEqual(["glasses:square"]);
    expect(unseenNewItems([...NEW_ITEMS])).toEqual([]);
  });
});
