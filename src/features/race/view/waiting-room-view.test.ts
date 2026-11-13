import type { Member } from "@fifth-copy/protocol";
import { describe, expect, it } from "vitest";
import { arrivalOrder, waitingRoomView, type WaitingRoomInput } from "./waiting-room-view";

// #937 C2-C4: the waiting room's view model, pure, from the #926 store slices.

const member = (desk: number, name: string, isBot = false): Member => ({
  desk,
  name,
  isHost: desk === 1,
  isBot,
  color: desk % 12,
  marker: "circle",
  avatar: null,
});

const members = [member(1, "Roy"), member(2, "Nguyen"), member(5, "Bot Ada", true)];

const input = (over: Partial<WaitingRoomInput> = {}): WaitingRoomInput => ({
  code: "KGB-4821",
  settings: { language: "fr", textType: "sentences" },
  you: 2,
  members,
  pending: [1, 2],
  raceIn: true,
  sceneSettled: false,
  ...over,
});

describe("waitingRoomView (#937)", () => {
  it("C2 the docket rows: room, text, language, your desk (two digits), desks ready over desks", () => {
    const v = waitingRoomView(input(), []);
    expect(v.code).toBe("KGB-4821");
    expect(v.textType).toBe("sentences");
    expect(v.language).toBe("fr");
    expect(v.desk).toBe("02");
    expect(v.ready).toBe("01 / 03");
  });

  it("C2 a page without a desk (the watching host) has no DESK value", () => {
    expect(waitingRoomView(input({ you: null }), []).desk).toBeNull();
  });

  it("C3 steps follow this device: papers, desk, then the current step is machines", () => {
    const v = waitingRoomView(input(), []);
    expect(v.steps.map((s) => [s.id, s.state])).toEqual([
      ["papers", "done"],
      ["desk", "done"],
      ["machines", "current"],
      ["copy", "todo"],
      ["major", "todo"],
    ]);
    expect(v.current).toBe("machines");
    // (2 own steps + 1/3 desks ready) / 5
    expect(v.percent).toBe(47);
  });

  it("C3 no race text yet: papers is current, only the share counts", () => {
    const v = waitingRoomView(input({ raceIn: false, pending: [1, 2, 5] }), []);
    expect(v.current).toBe("papers");
    expect(v.steps.map((s) => s.state)).toEqual(["current", "todo", "todo", "todo", "todo"]);
    expect(v.percent).toBe(0);
  });

  it("C3 settled and reported: copy done, the Major (the others) is current", () => {
    const v = waitingRoomView(input({ sceneSettled: true, pending: [1] }), []);
    expect(v.steps.map((s) => s.state)).toEqual(["done", "done", "done", "done", "current"]);
    expect(v.current).toBe("major");
    expect(v.percent).toBe(Math.round((100 * (4 + 2 / 3)) / 5));
  });

  it("C3 nobody awaited: every step done, no current step, 100 %", () => {
    const v = waitingRoomView(input({ sceneSettled: true, pending: [] }), []);
    expect(v.steps.every((s) => s.state === "done")).toBe(true);
    expect(v.current).toBeNull();
    expect(v.percent).toBe(100);
  });

  it("C3 a page without a desk counts DESK and COPY done", () => {
    const v = waitingRoomView(input({ you: null, sceneSettled: true }), []);
    expect(v.steps.map((s) => s.state)).toEqual(["done", "done", "done", "done", "current"]);
  });

  it("C4 arrivals: the members no longer awaited, in the given order, with two-digit desks", () => {
    const v = waitingRoomView(input({ pending: [1] }), [2, 5]);
    expect(v.arrivals).toEqual([
      { desk: "02", name: "Nguyen" },
      { desk: "05", name: "Bot Ada" },
    ]);
  });

  it("C4 an order entry whose member left is skipped", () => {
    expect(waitingRoomView(input({ pending: [] }), [9, 1]).arrivals).toEqual([
      { desk: "01", name: "Roy" },
    ]);
  });
});

describe("arrivalOrder (#937 C4)", () => {
  it("puts new arrivals first, a batch by desk number, and keeps earlier ones after", () => {
    expect(arrivalOrder([], [5, 3])).toEqual([3, 5]);
    expect(arrivalOrder([3, 5], [3, 5, 9, 7])).toEqual([7, 9, 3, 5]);
  });

  it("drops desks that are no longer arrived and keeps the reference when unchanged", () => {
    expect(arrivalOrder([7, 9, 3], [3, 7])).toEqual([7, 3]);
    const prev = [2, 1];
    expect(arrivalOrder(prev, [1, 2])).toBe(prev);
  });

  it("arrivedDesks: the members whose desk is not awaited", async () => {
    const { arrivedDesks } = await import("./waiting-room-view");
    expect(arrivedDesks(members, [1])).toEqual([2, 5]);
    expect(arrivedDesks(members, null)).toEqual([]);
  });
});
