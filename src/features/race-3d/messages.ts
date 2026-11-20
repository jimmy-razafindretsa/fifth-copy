/**
 * The seat scene's wire (ADR 0017 option A, #563): the page -> scene `fc-race-*` messages and the scene
 * -> page `fc-scene-*` replies of `/3d/seat.html`, every one carrying `v: SCENE_PROTOCOL` (bump on any
 * shape change, on both sides: the served page checks the same `type` and `v`). Hand-written guards, not
 * zod (ADR 0017 amendment, #563): this module is in the race-3d client chunk, and zod classic costs
 * ~91 kB gzip in a chunk (#626); the checks are the same ones a schema would make.
 */
import type { SceneSabotage, SceneView } from "@/features/race";

/**
 * 2 (#999 M2, M3b): the one-shot sabotage message and its acknowledgement, and the overview camera's
 * plaque anchors; a v1 message is dropped both ways.
 */
export const SCENE_PROTOCOL = 2;

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
/**
 * The protocol's bonus kinds (`bonusKindSchema`), written out: this chunk never loads the protocol's zod
 * (#626). `messages.test.ts` pins the list to the protocol's.
 */
export const SABOTAGE_KINDS = ["extra-paperwork", "exemption", "smoke-break"] as const;
export type SabotageKind = (typeof SABOTAGE_KINDS)[number];
/** `throw`: the scene played the gesture and flight; `static`: the object appears where it lands (reduce). */
export const SABOTAGE_MODES = ["throw", "static"] as const;
export type SabotageMode = (typeof SABOTAGE_MODES)[number];
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
/**
 * A sabotage card was played (#999 C60): a one-shot event, never a field of `SceneView` (a view replays
 * safely after a reload, an event must not). `to`: the hit desks; an Exemption is `[from]`.
 */
export type RaceSabotageMessage = {
  type: "fc-race-sabotage";
  v: number;
  kind: SabotageKind;
  from: number;
  to: number[];
};

const v = SCENE_PROTOCOL;
/** `camera`: the seat POV (a desk's page), or the orbiting overview (the projector, #999 C2; bible 11.3). */
export const raceInitMessage = (
  view: SceneView,
  preset: ScenePresetChoice,
  motion: SceneMotion,
  camera: SceneCamera = "pov",
): RaceInitMessage => ({ type: "fc-race-init", v, view, preset, motion, camera });
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

export const raceSabotageMessage = ({ kind, from, to }: SceneSabotage): RaceSabotageMessage => ({
  type: "fc-race-sabotage",
  v,
  kind,
  from,
  to: [...to],
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
  /** #951: the frame rate the scene measured when it gave up (`benchmark-low`), when it has one. */
  fps?: number;
};
/** The scene played (or placed) a sabotage it was sent (#999 C60): e2e proves the scene saw it. */
export type SceneSabotageMessage = {
  type: "fc-scene-sabotage";
  v: number;
  kind: SabotageKind;
  from: number;
  to: number[];
  mode: SabotageMode;
};
/**
 * One desk's plaque point (#999 C4): `[desk, x, y]`, x and y in 0..1 of the scene's frame (0, 0 = top
 * left), the point above the typist's head projected by the overview camera.
 */
export type SceneAnchor = readonly [desk: number, x: number, y: number];
/**
 * Where each desk's rank plaque stands (#999 C4, bible 15): sent only by the `over` camera, every drawn
 * frame while it orbits and once per layout when still; a desk off screen is absent.
 */
export type SceneAnchorsMessage = { type: "fc-scene-anchors"; v: number; anchors: SceneAnchor[] };
export type SceneMessage =
  | SceneHelloMessage
  | SceneAnchorsMessage
  | SceneReadyMessage
  | SceneTelemetryMessage
  | SceneFallbackMessage
  | SceneSabotageMessage;

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const count = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T =>
  (list as readonly unknown[]).includes(x);
/** A desk number (1-based); the scene never sees more desks than this. */
const MAX_SCENE_DESKS = 64;
const desk = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 1;
const desks = (x: unknown): x is number[] =>
  Array.isArray(x) && x.length >= 1 && x.length <= MAX_SCENE_DESKS && x.every(desk);

const unit = (x: unknown): x is number => count(x) && (x as number) <= 1;
const anchor = (x: unknown): x is SceneAnchor =>
  Array.isArray(x) && x.length === 3 && desk(x[0]) && unit(x[1]) && unit(x[2]);

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
        ? { type: data.type, v, reason: data.reason, ...(count(data.fps) ? { fps: data.fps } : {}) }
        : null;
    case "fc-scene-sabotage":
      return oneOf(SABOTAGE_KINDS, data.kind) &&
        desk(data.from) &&
        desks(data.to) &&
        oneOf(SABOTAGE_MODES, data.mode)
        ? {
            type: data.type,
            v,
            kind: data.kind,
            from: data.from,
            to: [...data.to],
            mode: data.mode,
          }
        : null;
    case "fc-scene-anchors":
      return Array.isArray(data.anchors) &&
        data.anchors.length <= MAX_SCENE_DESKS &&
        data.anchors.every(anchor)
        ? {
            type: data.type,
            v,
            anchors: data.anchors.map(([d, x, y]: SceneAnchor) => [d, x, y] as const),
          }
        : null;
    default:
      return null;
  }
}

/** The page's `?preset=` (tests force `low`, bible 12); anything else is `auto`. */
export const presetChoice = (raw: string | null | undefined): ScenePresetChoice =>
  oneOf(SCENE_PRESETS, raw) ? raw : "auto";

/** Whether the running scene's frame budget (#695, `frame-budget.ts`) may replace it with paper. */
export type SceneBudget = "on" | "off";
export type SceneSettings = { preset: ScenePresetChoice; budget: SceneBudget };

/**
 * The page's scene settings from its `?preset=` and `?scene=` values (bible 12): `?scene=pin` is the
 * test-only pin of the `@scene` e2e specs (#695 C9; software WebGL draws LOW under the budget's floor):
 * LOW forced, no benchmark, frame budget off (`no-webgl2` and `context-lost` still fall back). Without
 * it, `?preset=` forces a preset or `auto` runs the benchmark, and the budget is on.
 */
export const sceneSettings = (
  preset: string | null | undefined,
  scene: string | null | undefined,
): SceneSettings =>
  scene === "pin"
    ? { preset: "low", budget: "off" }
    : { preset: presetChoice(preset), budget: "on" };

/** The embed's URL: the preset rides along so the first frame already uses it. */
export const seatEmbedSrc = (preset: ScenePresetChoice) => `${SEAT_EMBED}?preset=${preset}`;
