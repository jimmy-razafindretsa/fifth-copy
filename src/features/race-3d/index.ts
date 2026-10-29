/**
 * The race's 3D seat scene (#563, ADR 0017 option A, ADR 0013): a client leaf that mounts `/3d/seat.html`
 * in an `EmbedFrame` and drives it with the `fc-race-*` messages; `three` is in no Next chunk (the embed
 * loads it from `/3d/vendor/`). Imported only by `src/app/race`, lazily (`next/dynamic`, `ssr: false`,
 * after the HUD mounted); it imports only `@/features/race` (index) and `@/components/ui`.
 */
export { RaceScene, type RaceSceneProps } from "./race-scene";
export { detectWebGL2 } from "./detect-webgl";
export {
  presetChoice,
  SCENE_PRESETS,
  type SceneFallbackReason,
  type SceneMotion,
  type ScenePreset,
  type ScenePresetChoice,
  type SceneTelemetry,
} from "./messages";
export {
  FRAME_BUDGET_START,
  frameBudget,
  SCENE_BUDGET_STRIKES,
  SCENE_MIN_FPS,
  type FrameBudget,
} from "./frame-budget";
