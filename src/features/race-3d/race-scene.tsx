"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EmbedFrame, useEmbedBridge, useReducedMotion } from "@/components/ui";
import type { SceneView } from "@/features/race";
import { detectWebGL2 } from "./detect-webgl";
import { FRAME_BUDGET_START, frameBudget } from "./frame-budget";
import {
  parseSceneMessage,
  raceInitMessage,
  raceMotionMessage,
  raceStateMessage,
  sceneSettings,
  seatEmbedSrc,
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
   * The page's `?preset=` value: `low`, `medium` or `high` forces that preset (tests force `low`, bible
   * 12); anything else (or nothing) lets the scene's benchmark choose.
   */
  preset?: string | null;
  /** The page's `?scene=` value: `pin` (tests only, #695 C9) forces `low` and turns the frame budget off. */
  scene?: string | null;
  /** The frame's name (catalog `race.scene.title`); the frame is decorative all the same. */
  title: string;
  /** The preset is settled (benchmark done, or the forced preset's first frame): the loading card goes. */
  onReady?: () => void;
  /**
   * The scene cannot run, or (`frame-budget`, #695) can no longer hold its frame budget: the page drops
   * it for paper with the `no-scene` notice (C3). Called at most once for a blown budget.
   */
  onFallback?: (reason: RaceSceneFallback) => void;
  /** Every second while rendering (ADR 0013 budgets, #275). */
  onTelemetry?: (telemetry: SceneTelemetry) => void;
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
 * It never writes race state: nothing here reaches the store.
 */
export function RaceScene({
  view,
  preset: requested,
  scene: pin,
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
  const latest = useRef({ view, reduce, onReady, onFallback, onTelemetry });
  const hello = useRef(false);
  useEffect(() => {
    latest.current = { view, reduce, onReady, onFallback, onTelemetry };
  });

  const postRef = useRef<(message: unknown) => void>(() => {});
  const onMessage = useCallback(
    (message: SceneMessage) => {
      const post = postRef.current;
      const now = latest.current;
      switch (message.type) {
        case "fc-scene-hello":
          hello.current = true;
          post(raceInitMessage(now.view, preset, now.reduce ? "reduce" : "full"));
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
          if (health.current.verdict === "fallback") now.onFallback?.("frame-budget");
          return;
        }
        case "fc-scene-fallback":
          now.onFallback?.(message.reason);
          return;
      }
    },
    [preset, budget],
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
      data-scene-self={ready ? "hidden" : undefined}
      data-scene-motion={reduce ? "reduce" : "full"}
      data-scene-budget={budget}
      className={styles.scene}
    >
      <EmbedFrame ref={ref} src={seatEmbedSrc(preset)} title={title} decorative />
    </div>
  );
}
