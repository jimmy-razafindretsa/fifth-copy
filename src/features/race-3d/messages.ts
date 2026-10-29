/**
 * The seat scene's wire (ADR 0017 option A, #563): the page -> scene `fc-race-*` messages and the scene
 * -> page `fc-scene-*` replies of `/3d/seat.html`, every one carrying `v: SCENE_PROTOCOL` (bump on any
 * shape change, on both sides: the served page checks the same `type` and `v`). Hand-written guards, not
 * zod (ADR 0017 amendment, #563): this module is in the race-3d client chunk, and zod classic costs
 * ~91 kB gzip in a chunk (#626); the checks are the same ones a schema would make.
 */
import type { SceneView } from "@/features/race";

export const SCENE_PROTOCOL = 1;

/** The served embed (bible 16, scripts/embeds.ts). */
export const SEAT_EMBED = "/3d/seat.html";

/** Bible 12 presets; `auto` runs the scene's 2 s benchmark. */
export const SCENE_PRESETS = ["low", "medium", "high"] as const;
export type ScenePreset = (typeof SCENE_PRESETS)[number];
export type ScenePresetChoice = ScenePreset | "auto";
/** `prefers-reduced-motion` or `<html data-motion="reduce">` (#28): the page's, never the scene's. */
export type SceneMotion = "full" | "reduce";
export type SceneCamera = "pov" | "over";
export const SCENE_FALLBACKS = ["no-webgl2", "benchmark-low", "context-lost"] as const;
export type SceneFallbackReason = (typeof SCENE_FALLBACKS)[number];
export type SceneTelemetry = {
  fps: number;
  calls: number;
  triangles: number;
  preset: ScenePreset;
  /** A flat ~30 fps with idle frames: a browser cap, not a GPU limit (bible 12). */
  capped: boolean;
};

// page -> scene

export type RaceInitMessage = {
  type: "fc-race-init";
  v: number;
  view: SceneView;
  preset: ScenePresetChoice;
  motion: SceneMotion;
  camera: SceneCamera;
};
export type RaceStateMessage = { type: "fc-race-state"; v: number; view: SceneView };
export type RaceMotionMessage = { type: "fc-race-motion"; v: number; motion: SceneMotion };
export type RacePresetMessage = { type: "fc-race-preset"; v: number; preset: ScenePreset };

const v = SCENE_PROTOCOL;
export const raceInitMessage = (
  view: SceneView,
  preset: ScenePresetChoice,
  motion: SceneMotion,
): RaceInitMessage => ({ type: "fc-race-init", v, view, preset, motion, camera: "pov" });
export const raceStateMessage = (view: SceneView): RaceStateMessage => ({
  type: "fc-race-state",
  v,
  view,
});
export const raceMotionMessage = (motion: SceneMotion): RaceMotionMessage => ({
  type: "fc-race-motion",
  v,
  motion,
});
export const racePresetMessage = (preset: ScenePreset): RacePresetMessage => ({
  type: "fc-race-preset",
  v,
  preset,
});

// scene -> page

export type SceneHelloMessage = { type: "fc-scene-hello"; v: number };
export type SceneReadyMessage = {
  type: "fc-scene-ready";
  v: number;
  preset: ScenePreset;
  fov: number;
  desks: number;
};
export type SceneTelemetryMessage = { type: "fc-scene-telemetry"; v: number } & SceneTelemetry;
export type SceneFallbackMessage = {
  type: "fc-scene-fallback";
  v: number;
  reason: SceneFallbackReason;
};
export type SceneMessage =
  SceneHelloMessage | SceneReadyMessage | SceneTelemetryMessage | SceneFallbackMessage;

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const count = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T =>
  (list as readonly unknown[]).includes(x);

/** A scene -> page message of this protocol version with a well-formed payload, or `null`. */
export function parseSceneMessage(data: unknown): SceneMessage | null {
  if (!isRecord(data) || data.v !== SCENE_PROTOCOL) return null;
  switch (data.type) {
    case "fc-scene-hello":
      return { type: data.type, v };
    case "fc-scene-ready":
      return oneOf(SCENE_PRESETS, data.preset) && count(data.fov) && count(data.desks)
        ? { type: data.type, v, preset: data.preset, fov: data.fov, desks: data.desks }
        : null;
    case "fc-scene-telemetry":
      return count(data.fps) &&
        count(data.calls) &&
        count(data.triangles) &&
        oneOf(SCENE_PRESETS, data.preset) &&
        typeof data.capped === "boolean"
        ? {
            type: data.type,
            v,
            fps: data.fps,
            calls: data.calls,
            triangles: data.triangles,
            preset: data.preset,
            capped: data.capped,
          }
        : null;
    case "fc-scene-fallback":
      return oneOf(SCENE_FALLBACKS, data.reason)
        ? { type: data.type, v, reason: data.reason }
        : null;
    default:
      return null;
  }
}

/** The page's `?preset=` (tests force `low`, bible 12); anything else is `auto`. */
export const presetChoice = (raw: string | null | undefined): ScenePresetChoice =>
  oneOf(SCENE_PRESETS, raw) ? raw : "auto";

/** The embed's URL: the preset rides along so the first frame already uses it. */
export const seatEmbedSrc = (preset: ScenePresetChoice) => `${SEAT_EMBED}?preset=${preset}`;
