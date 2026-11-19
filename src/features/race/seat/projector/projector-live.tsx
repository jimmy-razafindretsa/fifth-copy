"use client";

import { useEffect, useMemo, useRef } from "react";
import { connectSeat, type MintRaceToken } from "../../client/connect-seat";
import { selectProjectorState, selectReadyLine } from "../../client/store";
import { useRaceStore, useRaceStoreApi } from "../../client/use-race-store";
import { RaceSeatLiveView, useCountdownStep } from "../race-seat-live";
import type { RaceSeatLabels } from "../seat-view";
import { topTenRows } from "../../view/standings";
import { Countdown } from "../../components/countdown";
import { FinishedView } from "../../components/finished-view";
import { LoadingCard, type SceneLabels } from "../../components/loading-card";
import { Top10Sidebar, type ProjectorLabels } from "../../components/spectator/top10-sidebar";

/** The projector's copy: the seat view's live-state slices, its own, the loading card's. */
export type ProjectorScreenLabels = Pick<
  RaceSeatLabels,
  "loading" | "notice" | "errors" | "presence" | "countdown" | "finish"
> & {
  projector: ProjectorLabels;
  scene: SceneLabels;
  /** The READY row's label (`race.waiting.rows.ready`). */
  waiting: { rows: { ready: string } };
};

/**
 * The projector's live state (#999 C1, C6; bible 14.3 "Projector view"): it mints a `spectator` token
 * through the lobby action and joins the room with no desk (`connectSeat({ spectator: true })`): no
 * typing path, no `ready`, no resume key, so the host's own seat page is never touched. It renders the
 * stage's state: the connecting skeleton, WAITING FOR THE HOST, the loading card with the READY count
 * (#926), the 3-2-1 and the GO stamp (#214), nothing while racing, RACE OVER with the Dawn report link
 * (#240), and the cut line or the lost room as on the seat view. Its root carries `data-projector-state`.
 */
export function ProjectorLive({
  code,
  lobbyId,
  mint,
  labels,
}: {
  code: string;
  lobbyId: string;
  mint: MintRaceToken;
  labels: ProjectorScreenLabels;
}) {
  const store = useRaceStoreApi();
  const state = useRaceStore(selectProjectorState);
  const phase = useRaceStore((s) => s.phase);
  const lost = useRaceStore((s) => s.lost);
  const ready = useRaceStore(selectReadyLine);
  const ending = useRaceStore((s) => s.ending);
  const raceId = useRaceStore((s) => s.race?.raceId ?? null);
  const step = useCountdownStep();
  // the action reference changes when the route's payload refreshes: read the latest, never reconnect
  const mintRef = useRef(mint);
  useEffect(() => {
    mintRef.current = mint;
  }, [mint]);

  useEffect(
    () =>
      connectSeat({
        code,
        lobbyId,
        spectator: true,
        mint: (input) => mintRef.current(input),
        dispatch: store.dispatch,
      }),
    [code, lobbyId, store],
  );

  const status = useMemo(() => ({ ...labels, loading: labels.projector.connecting }), [labels]);

  let body: React.ReactNode = null;
  switch (state) {
    case "loading":
      body = (
        <LoadingCard
          labels={labels.scene}
          tip={null}
          ready={ready === null ? null : { label: labels.waiting.rows.ready, value: ready }}
        />
      );
      break;
    case "countdown":
    case "racing":
      body = step === null ? null : <Countdown step={step} labels={labels.countdown} />;
      break;
    case "finished": {
      const id = ending?.raceId ?? raceId;
      body = (
        <FinishedView
          mode="ended"
          value={ending && ending.reason !== "void" ? labels.finish.reason[ending.reason] : null}
          rows={[]}
          report={id === null ? null : `/results/${id}`}
          labels={labels.finish}
        />
      );
      break;
    }
    default:
      body = <RaceSeatLiveView phase={phase} lost={lost} code={code} labels={status} />;
  }
  return (
    <div data-projector-state={state} data-phase={phase} className="contents">
      {body}
    </div>
  );
}

/**
 * The projector's top-10 sidebar over the store (#999 C3): `topTenRows` of the roster, the last
 * snapshot and the server's final ranking, memoised per snapshot; never a `you`.
 */
export function Top10Live({
  labels,
}: {
  labels: Pick<ProjectorScreenLabels, "projector" | "finish">;
}) {
  const members = useRaceStore((s) => s.members);
  const desks = useRaceStore((s) => s.desks);
  const ranks = useRaceStore((s) => s.ranks);
  const race = useRaceStore((s) => s.race);
  const ending = useRaceStore((s) => s.ending);
  const rows = useMemo(
    () => topTenRows({ members, desks, ranks, race, ending }, labels.finish),
    [members, desks, ranks, race, ending, labels.finish],
  );
  return <Top10Sidebar rows={rows} count={members.length} labels={labels.projector} />;
}
