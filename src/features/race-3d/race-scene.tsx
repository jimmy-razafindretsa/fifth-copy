"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EmbedFrame, useEmbedBridge, useReducedMotion } from "@/components/ui";
import type { SceneSabotage, SceneView } from "@/features/race";
import { detectWebGL2 } from "./detect-webgl";
import { FRAME_BUDGET_START, frameBudget } from "./frame-budget";
import {
  parseSceneMessage,
  raceInitMessage,
  raceMotionMessage,
  racePresetMessage,
  raceSabotageMessage,
  raceStateMessage,
  sceneSettings,
  seatEmbedSrc,
  type SceneAnchor,
  type SceneCamera,
  type SceneFallbackReason,
  type SceneMessage,
  type ScenePreset,
  type SceneTelemetry,
} from "./messages";
import styles from "./race-scene.module.css";

export type RaceSceneProps = {
  /** `selectSceneView` of the race store: the only thing the scene reads (ADR 0017). */
  view: SceneView;
  /**
   * `selectSceneSabotage` of the race store (#999 C61): each new `seq` is posted once as
   * `fc-race-sabotage`; one already there when the scene says hello is never sent (no replay).
   */
  sabotage?: SceneSabotage | null;
  /**
   * The page's `?preset=` value: `low`, `medium` or `high` forces that preset (tests force `low`, bible
   * 12); anything else (or nothing) lets the scene's benchmark choose.
   */
  preset?: string | null;
  /** The page's `?scene=` value: `pin` (tests only, #695 C9) forces `low` and turns the frame budget off. */
  scene?: string | null;
  /**
   * `pov` (default): the seat's own view. `over` (#999 C2, the projector): the orbiting overview, which
   * reports each on-screen desk's plaque point (`onAnchors`).
   */
  camera?: SceneCamera;
  /** The overview's plaque points (#999 C4), every drawn frame while it orbits; never on the POV. */
  onAnchors?: (anchors: readonly SceneAnchor[]) => void;
  /** The frame's name (catalog `race.scene.title`); the frame is decorative all the same. */
  title: string;
  /** The room's first frame at the settled (probed or forced) preset, #695: the loading card goes. */
  onReady?: () => void;
  /**
   * The scene cannot run, or (`frame-budget`, #695) can no longer hold its frame budget: the page drops
   * it for paper with the `no-scene` notice (C3). Called at most once for a blown budget.
   */
  onFallback?: (reason: RaceSceneFallback, fps?: number) => void;
  /** Every second while rendering (ADR 0013 budgets, #275). */
  onTelemetry?: (telemetry: SceneTelemetry) => void;
};

/** #951: the preset a blown frame budget steps down to before the scene drops to paper. */
const LOWER_PRESET: Record<ScenePreset, ScenePreset | null> = {
  high: "medium",
  medium: "low",
  low: null,
};

/** The scene's own fallbacks (`fc-scene-fallback`) and the page-side frame budget's (#695). */
export type RaceSceneFallback = SceneFallbackReason | "frame-budget";

type Ready = { preset: ScenePreset; fov: number; desks: number };

/**
 * The seat scene (#563, ADR 0017 option A): `/3d/seat.html` in a decorative `EmbedFrame` (no focus, no
 * pointer) behind the HUD. On the scene's `fc-scene-hello` it posts `fc-race-init` (the view, the preset,
 * the page's motion setting, the seat camera); view changes follow as `fc-race-state`, at most one per
 * animation frame, and motion changes as `fc-race-motion`. The scene answers `fc-scene-ready` (the
 * container then reports `data-scene-fov|desks|preset|self`), telemetry and fallbacks. Every telemetry
 * second goes through `frameBudget` (#695, ADR 0013's Low floor on a running scene): a blown budget is
 * `onFallback("frame-budget")`, once; under `?scene=pin` (`data-scene-budget="off"`) verdicts are ignored.
 * A sabotage play (#999) is posted once per `seq` as `fc-race-sabotage`; the scene's `fc-scene-sabotage`
 * ack is written to `data-scene-sabotage` (`<kind>:<from>:<to,...>:<mode>`, e2e reads it). With
 * `camera: "over"` (#999 C2, the projector) the init asks for the orbiting overview and the scene's
 * `fc-scene-anchors` go to `onAnchors` (the rank plaques, C4); `data-scene-camera` says which.
 * It never writes race state: nothing here reaches the store.
 */
export function RaceScene({
  view,
  sabotage = null,
  preset: requested,
  scene: pin,
  camera = "pov",
  onAnchors,
  title,
  onReady,
  onFallback,
  onTelemetry,
}: RaceSceneProps) {
  const { preset, budget } = sceneSettings(requested, pin);
  const health = useRef(FRAME_BUDGET_START);
  const reduce = useReducedMotion();
  const [ready, setReady] = useState<Ready | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef({ view, sabotage, reduce, onReady, onFallback, onTelemetry, onAnchors });
  const hello = useRef(false);
  /** The last sabotage `seq` posted, or there before the hello (never replayed). */
  const played = useRef(0);
  useEffect(() => {
    latest.current = { view, sabotage, reduce, onReady, onFallback, onTelemetry, onAnchors };
  });

  const postRef = useRef<(message: unknown) => void>(() => {});
  const onMessage = useCallback(
    (message: SceneMessage) => {
      const post = postRef.current;
      const now = latest.current;
      switch (message.type) {
        case "fc-scene-hello":
          hello.current = true;
          played.current = Math.max(played.current, now.sabotage?.seq ?? 0);
          post(raceInitMessage(now.view, preset, now.reduce ? "reduce" : "full", camera));
          return;
        case "fc-scene-ready":
          setReady({ preset: message.preset, fov: message.fov, desks: message.desks });
          now.onReady?.();
          return;
        case "fc-scene-telemetry": {
          const { fps, calls, triangles, preset: drawn, capped } = message;
          // not React's attributes: one write a second, no re-render
          const node = container.current;
          if (node) {
            node.dataset.sceneFps = String(fps);
            node.dataset.sceneCalls = String(calls);
          }
          const telemetry = { fps, calls, triangles, preset: drawn, capped };
          now.onTelemetry?.(telemetry);
          if (budget === "off" || health.current.verdict === "fallback") return;
          health.current = frameBudget(health.current, telemetry);
          if (health.current.verdict !== "fallback") return;
          // #951: a blown budget steps the preset down first; only LOW under the floor drops to paper
          const lower = LOWER_PRESET[drawn];
          if (lower) {
            post(racePresetMessage(lower));
            health.current = FRAME_BUDGET_START;
            return;
          }
          now.onFallback?.("frame-budget", fps);
          return;
        }
        case "fc-scene-fallback":
          now.onFallback?.(message.reason, message.fps);
          return;
        case "fc-scene-anchors":
          if (camera === "over") now.onAnchors?.(message.anchors);
          return;
        case "fc-scene-sabotage": {
          const node = container.current;
          if (node)
            node.dataset.sceneSabotage = [
              message.kind,
              message.from,
              message.to.join(","),
              message.mode,
            ].join(":");
          return;
        }
      }
    },
    [preset, budget, camera],
  );
  const { ref, post } = useEmbedBridge(parseSceneMessage, onMessage);
  useEffect(() => {
    postRef.current = post;
  }, [post]);

  // no WebGL2 here: never mount the frame (the route checks first; this guards a direct mount)
  useEffect(() => {
    if (!detectWebGL2()) latest.current.onFallback?.("no-webgl2");
  }, []);

  // the view, coalesced to one message per animation frame
  useEffect(() => {
    if (!hello.current) return;
    const frame = requestAnimationFrame(() => post(raceStateMessage(view)));
    return () => cancelAnimationFrame(frame);
  }, [view, post]);

  // each sabotage play once, at once (an event, not a view: never coalesced or replayed)
  useEffect(() => {
    if (!hello.current || !sabotage || sabotage.seq <= played.current) return;
    played.current = sabotage.seq;
    post(raceSabotageMessage(sabotage));
  }, [sabotage, post]);

  useEffect(() => {
    if (hello.current) post(raceMotionMessage(reduce ? "reduce" : "full"));
  }, [reduce, post]);

  return (
    <div
      ref={container}
      data-scene={ready ? "ready" : "loading"}
      data-scene-fov={ready?.fov}
      data-scene-desks={ready?.desks}
      data-scene-preset={ready?.preset}
      data-scene-self={ready && camera === "pov" ? "hidden" : undefined}
      data-scene-camera={camera}
      data-scene-motion={reduce ? "reduce" : "full"}
      data-scene-budget={budget}
      className={styles.scene}
    >
      <EmbedFrame ref={ref} src={seatEmbedSrc(preset)} title={title} decorative />
    </div>
  );
}
