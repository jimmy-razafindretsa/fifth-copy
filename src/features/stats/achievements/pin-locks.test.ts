import { describe, expect, it, vi } from "vitest";
import { NEW_ITEMS, OUTFIT_CATALOGUE, PIN_LOCKS } from "@/features/identity";
import { ACHIEVEMENT_IDS, isAchievementId } from "./ids";

// identity's index reaches src/env.ts; these tests need no secrets
vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));

// #999 C36: the locked catalogue items of the locker (bible 10.1, 7.6) reference the pins' ids.
describe("PIN_LOCKS", () => {
  it("every lock names a stable achievement id, each pin unlocking one item", () => {
    const ids = Object.values(PIN_LOCKS);
    for (const id of ids) expect(isAchievementId(id), id).toBe(true);
    expect([...ids].sort()).toEqual([...ACHIEVEMENT_IDS].sort());
  });

  it("every locked item is a catalogue item, never one of the NEW items or a default issue", () => {
    for (const key of Object.keys(PIN_LOCKS)) {
      const [category, id] = key.split(":") as [keyof typeof OUTFIT_CATALOGUE, string];
      expect(OUTFIT_CATALOGUE[category], key).toContain(id);
      expect(NEW_ITEMS as readonly string[], key).not.toContain(key);
    }
  });
});
