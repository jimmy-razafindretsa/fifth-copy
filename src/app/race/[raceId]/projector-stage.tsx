"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { hasWebGL2 } from "@/components/ui";
import { ROOM_SEATS, SeatRing } from "@/features/lobby/client";
import {
  PHONE_QUERY,
  selectSceneSabotage,
  selectSceneView,
  usePlaqueAnchors,
  useRaceStore,
} from "@/features/race";
import type { Messages } from "@/i18n";

// ADR 0013, 0017: race-3d (and through its embed, three.js) loads only here, lazily, in the browser.
const RaceScene = dynamic(() => import("@/features/race-3d").then((m) => m.RaceScene), {
  ssr: false,
});

type Mode = "off" | "loading" | "ready" | "fallback";

/**
 * The projector's stage (#999 C2, C4, C6, C66; bible 14.3 "Projector view", 11.3 Overview): once mounted,
 * a browser with WebGL2 gets the seat embed with the orbiting overview camera (`camera: "over"`) over the
 * whole frame, fed by the spectator store's scene view (no `self`: no desk is hidden) and its sabotage
 * plays (the same `bonus-sent` mapping as a seat's, C66); the scene's anchors go to the rank plaques
 * through `usePlaqueAnchors` (C4). Until the room's first frame, and for good without WebGL2 or after a
 * fallback (no `no-scene` notice: nobody types here), the stage shows the lobby's seat ring diagram with
 * no `you` (`data-scene="paper"`), and the plaques stay hidden. The page URL's `?preset=` and `?scene=`
 * are forwarded (tests pin `low`). The projector never reports `ready` (#926): it holds no desk.
 */
export function ProjectorStage({
  labels,
  title,
}: {
  labels: Messages["lobby"]["ring"];
  /** `race.scene.title`: the frame's name. */
  title: string;
}) {
  const members = useRaceStore((s) => s.members);
  const known = useRaceStore((s) => s.room !== null);
  const view = useRaceStore(selectSceneView);
  const sabotage = useRaceStore(selectSceneSabotage);
  const anchors = usePlaqueAnchors();
  const [mode, setMode] = useState<Mode>("off");
  const [search, setSearch] = useState<{ preset: string | null; scene: string | null }>({
    preset: null,
    scene: null,
  });
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current) return;
    decided.current = true;
    const params = new URLSearchParams(window.location.search);
    setSearch({ preset: params.get("preset"), scene: params.get("scene") });
    setMode(!window.matchMedia(PHONE_QUERY).matches && hasWebGL2() ? "loading" : "fallback");
  }, []);

  return (
    <>
      {mode === "ready" ? null : (
        <div data-scene="paper">
          {known ? (
            <SeatRing members={members} you={null} seats={ROOM_SEATS} labels={labels} />
          ) : null}
        </div>
      )}
      {mode === "loading" || mode === "ready" ? (
        <RaceScene
          view={view}
          sabotage={sabotage}
          camera="over"
          onAnchors={anchors}
          preset={search.preset}
          scene={search.scene}
          title={title}
          onReady={() => setMode("ready")}
          onFallback={() => {
            anchors([]);
            setMode("fallback");
          }}
        />
      ) : null}
    </>
  );
}
