import { describe, expect, it } from "vitest";
import { createSpectatorSlots, MAX_SPECTATORS_PER_ROOM } from "./spectator-slots";

describe("spectator slots (#616)", () => {
  it("defaults to the 100-client fan-out budget (ARCHITECTURE 7.9)", () => {
    expect(MAX_SPECTATORS_PER_ROOM).toBe(100);
  });

  it("reserves up to the cap, then refuses", () => {
    const slots = createSpectatorSlots(2);
    expect(slots.reserve("a")).toBe(true);
    expect(slots.reserve("a")).toBe(true);
    expect(slots.reserve("a")).toBe(false);
    expect(slots.count("a")).toBe(2);
  });

  it("a release frees one slot for the next spectator", () => {
    const slots = createSpectatorSlots(1);
    expect(slots.reserve("a")).toBe(true);
    slots.release("a");
    expect(slots.count("a")).toBe(0);
    expect(slots.reserve("a")).toBe(true);
  });

  it("never goes below zero and forgets an empty room", () => {
    const slots = createSpectatorSlots(1);
    slots.release("a");
    expect(slots.count("a")).toBe(0);
    slots.reserve("a");
    slots.release("a");
    slots.release("a");
    expect(slots.count("a")).toBe(0);
    expect(slots.rooms()).toBe(0);
  });

  it("counts each room on its own", () => {
    const slots = createSpectatorSlots(1);
    expect(slots.reserve("a")).toBe(true);
    expect(slots.reserve("b")).toBe(true);
    expect(slots.reserve("a")).toBe(false);
    expect(slots.rooms()).toBe(2);
  });

  it("a cap of 0 refuses every spectator", () => {
    expect(createSpectatorSlots(0).reserve("a")).toBe(false);
  });
});
