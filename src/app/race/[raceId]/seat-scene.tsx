"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { hasWebGL2 } from "@/components/ui";
import {
  LoadingCard,
  PHONE_QUERY,
  RaceNotice,
  selectReadyLine,
  selectSceneGate,
  selectSceneView,
  useRaceDispatch,
  useRaceStore,
  type RaceNoticeLabels,
  type SceneLabels,
} from "@/features/race";

// ADR 0013, 0017: race-3d (and through its embed, three.js) loads only here, lazily, in the browser.
const RaceScene = dynamic(() => import("@/features/race-3d").then((m) => m.RaceScene), {
  ssr: false,
});

type Mode = "off" | "loading" | "ready" | "fallback";

export type SeatSceneProps = {
  /** `race.scene`: the loading stamp, the frame's name, the tip tag. */
  labels: SceneLabels;
  /** `race.notice`: the `no-scene` row is this leaf's (bible 7.4 extension #560). */
  notice: RaceNoticeLabels;
  /** `race.didYouKnow` (#383); one line shows under the stamp, none when empty. */
  tips: readonly string[];
};

/**
 * The race route's scene leaf (#563 C1-C3, ADR 0013 HUD first, ADR 0017): renders nothing on the server
 * and while hydrating; once the HUD has mounted (this effect), a browser with WebGL2 gets the loading card
 * and the lazily imported `RaceScene` (the page URL's `?preset=` and `?scene=` forwarded: tests pin `low`,
 * #695 C9), until the scene's preset is settled; a browser without WebGL2, or a scene that falls back
 * (benchmark below Low, a lost context, or a running scene that blows its frame budget, #695: `RaceScene`
 * puts every telemetry second through race-3d's `frameBudget`), unmounts the scene, frame and all, and
 * keeps the paper backdrop with the `no-scene` notice, once. Phones never load it (they watch, #292).
 * The readiness barrier (#926): it tells the store once that its scene is settled (first frame, or
 * paper), so the seat reports `ready`; while the room loads every device shows the loading card with
 * its READY row (a paper device in place of its notice); a typist whose scene is not up when the room
 * counts down or runs drops to paper for that race (`selectSceneGate`), and the scene waits for the
 * room's phase before it mounts, so a reload mid-race never loads it. The watching host is exempt.
 */
export function SeatScene({ labels, notice, tips }: SeatSceneProps) {
  const [mode, setMode] = useState<Mode>("off");
  const [preset, setPreset] = useState<string | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [scene, setScene] = useState<string | null>(null);
  const view = useRaceStore(selectSceneView);
  const gate = useRaceStore(selectSceneGate);
  const ready = useRaceStore(selectReadyLine);
  const dispatch = useRaceDispatch();
  // decided once per mount: a re-render with new `tips` must never bring a fallen-back scene back (#695 C2)
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current) return;
    decided.current = true;
    if (window.matchMedia(PHONE_QUERY).matches) return void dispatch({ type: "scene-settled" });
    // the HUD-first gate: browser-only facts, read once after mount
    const search = new URLSearchParams(window.location.search);
    setPreset(search.get("preset"));
    setScene(search.get("scene"));
    setTip(tips.length ? tips[Math.floor(Math.random() * tips.length)]! : null);
    setMode(hasWebGL2() ? "loading" : "fallback");
  }, [tips, dispatch]);

  // #926 C3: the scene is settled (its first frame, or paper): the seat may report ready
  useEffect(() => {
    if (mode === "ready" || mode === "fallback") dispatch({ type: "scene-settled" });
  }, [mode, dispatch]);

  // #926 C4: a typist's scene still loading when its room counts down or runs drops to paper
  useEffect(() => {
    if (mode === "loading" && gate === "paper") setMode("fallback");
  }, [mode, gate]);

  const card = <LoadingCard labels={labels} tip={tip} ready={ready} />;
  if (mode === "off") return null;
  if (mode === "fallback") return ready ? card : <RaceNotice kind="no-scene" labels={notice} />;
  return (
    <>
      {mode === "loading" || ready ? card : null}
      {gate === "wait" ? null : (
        <RaceScene
          view={view}
          preset={preset}
          scene={scene}
          title={labels.title}
          onReady={() => setMode("ready")}
          onFallback={() => setMode("fallback")}
        />
      )}
    </>
  );
}
