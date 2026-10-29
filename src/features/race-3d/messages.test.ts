import { describe, expect, it } from "vitest";
import type { SceneView } from "@/features/race";
import {
  parseSceneMessage,
  presetChoice,
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
    ["NaN fps", { type: "fc-scene-telemetry", v, fps: NaN, calls: 1, triangles: 1, preset: "low", capped: false }],
    ["capped not boolean", { type: "fc-scene-telemetry", v, fps: 1, calls: 1, triangles: 1, preset: "low", capped: 1 }],
    ["unknown reason", { type: "fc-scene-fallback", v, reason: "bored" }],
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
