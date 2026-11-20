"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { hasWebGL2 } from "@/components/ui";
import {
  PHONE_QUERY,
  RaceNotice,
  selectReadyLine,
  selectSceneGate,
  selectSceneSabotage,
  selectSceneView,
  useRaceDispatch,
  useRaceStore,
  WaitingRoomLive,
  type RaceNoticeLabels,
  type SceneLabels,
  type WaitingRoomLabels,
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
  /** `race.waiting` (#937): the waiting room shown while the room loads. */
  waiting: WaitingRoomLabels;
  /** `race.sceneDrop` (#951): why the 3D room went away, under the no-scene notice. */
  drop: Record<DropReason, string>;
};

type DropReason =
  | "no-webgl2"
  | "benchmark-low"
  | "benchmark-low-unknown"
  | "context-lost"
  | "frame-budget"
  | "late-load";

/** The sentence for a drop (#951), `{fps}` filled when the scene measured one. */
function dropText(
  drop: { reason: string; fps?: number } | null,
  labels: Record<DropReason, string>,
): string | null {
  if (!drop) return null;
  if (drop.reason === "benchmark-low" && drop.fps === undefined)
    return labels["benchmark-low-unknown"];
  const text = (labels as Record<string, string>)[drop.reason];
  return text ? text.replace("{fps}", String(drop.fps ?? "?")) : null;
}

/**
 * The race route's scene leaf (#563 C1-C3, ADR 0013 HUD first, ADR 0017): renders nothing on the server
 * and while hydrating; once the HUD has mounted (this effect), a browser with WebGL2 gets the loading card
 * and the lazily imported `RaceScene` (the page URL's `?preset=` and `?scene=` forwarded: tests pin `low`,
 * #695 C9), until the scene's preset is settled; a browser without WebGL2, or a scene that falls back
 * (benchmark below Low, a lost context, or a running scene that blows its frame budget, #695: `RaceScene`
 * puts every telemetry second through race-3d's `frameBudget`), unmounts the scene, frame and all, and
 * keeps the paper backdrop with the `no-scene` notice, once. Phones never load it (they watch, #292).
 * The readiness barrier (#926): it tells the store once that its scene is settled (first frame, or
 * paper), so the seat reports `ready`; while the room loads every device shows the waiting room (#937)
 * over the seat view (a paper device in place of its notice; the scene keeps loading behind it); a typist whose scene is not up when the room
 * counts down or runs drops to paper for that race (`selectSceneGate`), and the scene waits for the
 * room's phase before it mounts, so a reload mid-race never loads it. The watching host is exempt.
 */
export function SeatScene({ labels, notice, tips, waiting, drop: dropLabels }: SeatSceneProps) {
  const [mode, setMode] = useState<Mode>("off");
  const [drop, setDrop] = useState<{ reason: string; fps?: number } | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [scene, setScene] = useState<string | null>(null);
  const view = useRaceStore(selectSceneView);
  const sabotage = useRaceStore(selectSceneSabotage);
  const gate = useRaceStore(selectSceneGate);
  // non-null while the room loads (#926): the waiting room (#937) is up
  const loadingRoom = useRaceStore(selectReadyLine) !== null;
  const dispatch = useRaceDispatch();
  // decided once per mount: a re-render with new `tips` must never bring a fallen-back scene back (#695 C2)
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current || window.matchMedia(PHONE_QUERY).matches) return;
    decided.current = true;
    // the HUD-first gate: browser-only facts, read once after mount
    const search = new URLSearchParams(window.location.search);
    setPreset(search.get("preset"));
    setScene(search.get("scene"));
    setTip(tips.length ? tips[Math.floor(Math.random() * tips.length)]! : null);
    const webgl = hasWebGL2();
    setDrop(webgl ? null : { reason: "no-webgl2" });
    setMode(webgl ? "loading" : "fallback");
  }, [tips]);

  // #951: a new random tip every 7 s while the room loads (a text swap, no motion)
  useEffect(() => {
    if (!loadingRoom || tips.length < 2) return;
    const id = window.setInterval(() => {
      setTip((now) => {
        const others = tips.filter((t) => t !== now);
        return others[Math.floor(Math.random() * others.length)] ?? now;
      });
    }, 7_000);
    return () => window.clearInterval(id);
  }, [loadingRoom, tips]);

  // #926 C4: a typist's scene still loading when its room counts down or runs drops to paper for
  // that race (the frame unmounts; a later race may load it again)
  const shown: Mode = mode === "loading" && gate === "paper" ? "fallback" : mode;

  // #926 C3: the scene is settled (its first frame, or paper): the seat may report ready
  useEffect(() => {
    if (shown === "ready" || shown === "fallback") dispatch({ type: "scene-settled" });
  }, [shown, dispatch]);

  const room = <WaitingRoomLive labels={waiting} reconnecting={notice.reconnecting} tip={tip} />;
  // #951: the waiting room is the one loading screen, from the server's first paint (no LoadingCard
  // flash before it); it renders nothing once the room no longer loads
  if (mode === "off") return room;
  if (shown === "fallback")
    return (
      <>
        {room}
        {loadingRoom ? null : (
          <RaceNotice
            kind="no-scene"
            labels={notice}
            detail={dropText(
              drop ?? (mode === "loading" ? { reason: "late-load" } : null),
              dropLabels,
            )}
          />
        )}
      </>
    );
  return (
    <>
      {room}
      {gate === "wait" ? null : (
        <RaceScene
          view={view}
          sabotage={sabotage}
          preset={preset}
          scene={scene}
          title={labels.title}
          onReady={() => setMode("ready")}
          onFallback={(reason, fps) => {
            setDrop((d) => d ?? { reason, fps });
            setMode("fallback");
          }}
        />
      )}
    </>
  );
}
