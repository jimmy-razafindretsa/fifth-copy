import { describe, expect, it } from "vitest";
import { bonusKindSchema } from "@fifth-copy/protocol";
import type { SceneView } from "@/features/race";
import {
  raceSabotageMessage,
  SABOTAGE_KINDS,
  parseSceneMessage,
  presetChoice,
  sceneSettings,
  raceInitMessage,
  raceMotionMessage,
  racePresetMessage,
  raceStateMessage,
  SCENE_PROTOCOL,
  seatEmbedSrc,
} from "./messages";

// #563 (ADR 0017): the seat scene's message set, versioned, guarded by hand (#626).

const view: SceneView = { self: 2, desks: [], lamp: null, phase: "waiting" };
const v = SCENE_PROTOCOL;

describe("page -> scene builders", () => {
  it("carry the protocol version and the seat POV camera", () => {
    expect(raceInitMessage(view, "low", "reduce")).toEqual({
      type: "fc-race-init",
      v,
      view,
      preset: "low",
      motion: "reduce",
      camera: "pov",
    });
    expect(raceStateMessage(view)).toEqual({ type: "fc-race-state", v, view });
    expect(raceMotionMessage("full")).toEqual({ type: "fc-race-motion", v, motion: "full" });
    expect(racePresetMessage("high")).toEqual({ type: "fc-race-preset", v, preset: "high" });
  });
});

describe("parseSceneMessage", () => {
  it("accepts the four scene replies of this version", () => {
    expect(parseSceneMessage({ type: "fc-scene-hello", v })).toEqual({ type: "fc-scene-hello", v });
    const ready = { type: "fc-scene-ready", v, preset: "low", fov: 62, desks: 3 };
    expect(parseSceneMessage(ready)).toEqual(ready);
    const telemetry = {
      type: "fc-scene-telemetry",
      v,
      fps: 58,
      calls: 41,
      triangles: 120_000,
      preset: "medium",
      capped: false,
    };
    expect(parseSceneMessage(telemetry)).toEqual(telemetry);
    const fallback = { type: "fc-scene-fallback", v, reason: "benchmark-low" };
    expect(parseSceneMessage(fallback)).toEqual(fallback);
  });

  it("drops extra fields", () => {
    expect(parseSceneMessage({ type: "fc-scene-hello", v, html: "<b>" })).toEqual({
      type: "fc-scene-hello",
      v,
    });
  });

  it.each([
    ["not an object", "fc-scene-hello"],
    ["no version", { type: "fc-scene-hello" }],
    ["another version", { type: "fc-scene-hello", v: v + 1 }],
    ["unknown type", { type: "fc-race-init", v }],
    ["bad preset", { type: "fc-scene-ready", v, preset: "ultra", fov: 62, desks: 3 }],
    ["negative desks", { type: "fc-scene-ready", v, preset: "low", fov: 62, desks: -1 }],
    [
      "NaN fps",
      {
        type: "fc-scene-telemetry",
        v,
        fps: NaN,
        calls: 1,
        triangles: 1,
        preset: "low",
        capped: false,
      },
    ],
    [
      "capped not boolean",
      { type: "fc-scene-telemetry", v, fps: 1, calls: 1, triangles: 1, preset: "low", capped: 1 },
    ],
    ["unknown reason", { type: "fc-scene-fallback", v, reason: "bored" }],
    ["a v1 reply", { type: "fc-scene-hello", v: 1 }],
    [
      "a v1 sabotage ack",
      { type: "fc-scene-sabotage", v: 1, kind: "exemption", from: 1, to: [1], mode: "static" },
    ],
    [
      "unknown sabotage kind",
      { type: "fc-scene-sabotage", v, kind: "coffee", from: 1, to: [2], mode: "throw" },
    ],
    [
      "no target",
      { type: "fc-scene-sabotage", v, kind: "smoke-break", from: 1, to: [], mode: "throw" },
    ],
    [
      "desk 0",
      { type: "fc-scene-sabotage", v, kind: "smoke-break", from: 0, to: [2], mode: "throw" },
    ],
    [
      "fractional desk",
      { type: "fc-scene-sabotage", v, kind: "smoke-break", from: 1, to: [2.5], mode: "throw" },
    ],
    [
      "unknown mode",
      { type: "fc-scene-sabotage", v, kind: "smoke-break", from: 1, to: [2], mode: "slow" },
    ],
  ])("rejects %s", (_, data) => {
    expect(parseSceneMessage(data)).toBeNull();
  });
});

describe("preset choice", () => {
  it("forces only a known preset; anything else runs the benchmark", () => {
    expect(presetChoice("low")).toBe("low");
    expect(presetChoice("ultra")).toBe("auto");
    expect(presetChoice(null)).toBe("auto");
    expect(seatEmbedSrc("low")).toBe("/3d/seat.html?preset=low");
  });
});

// #695 C9: `?scene=pin` (tests only) pins the scene at LOW with the frame budget off; nothing else does.
describe("scene settings", () => {
  it("`scene=pin` forces low and turns the frame budget off, whatever `?preset=` says", () => {
    expect(sceneSettings(null, "pin")).toEqual({ preset: "low", budget: "off" });
    expect(sceneSettings("high", "pin")).toEqual({ preset: "low", budget: "off" });
  });

  it.each([null, undefined, "", "PIN", "pinned", "1", "off"])(
    "`scene=%s` does not pin: the benchmark runs, the budget is on",
    (scene) => {
      expect(sceneSettings(null, scene)).toEqual({ preset: "auto", budget: "on" });
    },
  );

  it("`?preset=` alone forces its preset but keeps the frame budget on", () => {
    expect(sceneSettings("low", null)).toEqual({ preset: "low", budget: "on" });
    expect(sceneSettings("medium", "nope")).toEqual({ preset: "medium", budget: "on" });
    expect(sceneSettings("ultra", null)).toEqual({ preset: "auto", budget: "on" });
  });
});

// Contract of #999 C60: SCENE_PROTOCOL 2, the page -> seat `fc-race-sabotage` and the seat -> page
// `fc-scene-sabotage` ack (`mode` = `throw` | `static`), hand-written guards.
describe("sabotage messages (#999 C60)", () => {
  it("SCENE_PROTOCOL is 2 (the embed says the same: scripts/embeds.test.ts)", () => {
    expect(SCENE_PROTOCOL).toBe(2);
  });

  it("the kinds are the protocol's bonus kinds", () => {
    expect([...SABOTAGE_KINDS]).toEqual(bonusKindSchema.options);
  });

  it("builds fc-race-sabotage from a play, without its seq", () => {
    const to = [1, 3];
    const message = raceSabotageMessage({ seq: 4, kind: "extra-paperwork", from: 2, to });
    expect(message).toEqual({ type: "fc-race-sabotage", v, kind: "extra-paperwork", from: 2, to });
    expect(message.to).not.toBe(to);
    expect(raceSabotageMessage({ seq: 1, kind: "exemption", from: 6, to: [6] })).toEqual({
      type: "fc-race-sabotage",
      v,
      kind: "exemption",
      from: 6,
      to: [6],
    });
  });

  it.each(["throw", "static"] as const)("accepts the %s ack and drops extra fields", (mode) => {
    const ack = { type: "fc-scene-sabotage", v, kind: "smoke-break", from: 4, to: [1, 2], mode };
    expect(parseSceneMessage({ ...ack, colour: "red" })).toEqual(ack);
  });
});

// Contract of #999 C2 and C4 (bible 11.3 Overview, 15; ADR 0017 SCENE_PROTOCOL 2): the projector's init
// asks for the orbiting overview; the overview answers with each on-screen desk's plaque point.
describe("overview camera and plaque anchors (#999 C2, C4)", () => {
  it("the init carries the overview camera when asked, the seat POV otherwise", () => {
    expect(raceInitMessage(view, "low", "full", "over")).toMatchObject({
      type: "fc-race-init",
      v,
      camera: "over",
    });
    expect(raceInitMessage(view, "low", "full").camera).toBe("pov");
  });

  it("accepts fc-scene-anchors: [desk, x, y] with x and y in 0..1, an empty list too", () => {
    const anchors = {
      type: "fc-scene-anchors",
      v,
      anchors: [
        [1, 0.25, 0.5],
        [7, 1, 0],
      ],
    };
    expect(parseSceneMessage(anchors)).toEqual(anchors);
    expect(parseSceneMessage({ type: "fc-scene-anchors", v, anchors: [] })).toEqual({
      type: "fc-scene-anchors",
      v,
      anchors: [],
    });
    // extra tuple members are dropped by the guard, never passed on
    expect(parseSceneMessage({ ...anchors, html: "<b>" })).toEqual(anchors);
  });

  it("drops a malformed anchor list, and any v1 message", () => {
    for (const anchors of [
      [[0, 0.5, 0.5]],
      [[1.5, 0.5, 0.5]],
      [[1, -0.1, 0.5]],
      [[1, 0.5, 1.2]],
      [[1, Number.NaN, 0.5]],
      [[1, 0.5]],
      [[1, 0.5, 0.5, 9]],
      [{ desk: 1, x: 0.5, y: 0.5 }],
      Array.from({ length: 65 }, (_, k) => [k + 1, 0.5, 0.5]),
      "1,0.5,0.5",
      null,
    ])
      expect(parseSceneMessage({ type: "fc-scene-anchors", v, anchors })).toBeNull();
    expect(
      parseSceneMessage({ type: "fc-scene-anchors", v: 1, anchors: [[1, 0.5, 0.5]] }),
    ).toBeNull();
  });
});
