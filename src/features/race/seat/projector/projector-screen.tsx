import type { ReactNode } from "react";
import type { MintRaceToken } from "../../client/connect-seat";
import { RaceStoreProvider } from "../../client/use-race-store";
import { PlaqueAnchorsProvider, RankPlaquesLive } from "../../components/spectator/rank-plaques";
import { ProjectorLive, Top10Live, type ProjectorScreenLabels } from "./projector-live";
import styles from "./projector-screen.module.css";

export type ProjectorScreenProps = {
  /** The room behind the page (`getRaceSeat`): the code the spectator token is minted for. */
  seat: { code: string; lobbyId: string };
  /** The `race` catalog of the request's language (ADR 0010). */
  labels: ProjectorScreenLabels;
  /** The lobby's `mintRaceToken` action, passed by the route (called with `spectator: true`). */
  mint: MintRaceToken;
  /**
   * The stage (#999 C2, C6): the route's client leaf. The overview scene behind everything once WebGL2
   * runs, else the lobby's CSS seat ring diagram with no `you` (the paper fallback). It sends the scene's
   * anchors to the plaques through `usePlaqueAnchors` (the provider is here).
   */
  stage?: ReactNode;
};

/**
 * `/race/[raceId]?view=projector` (#999 C1, C3, C6, C7; bible 14.3 "Projector view", ARCHITECTURE 7.8):
 * the teacher's big screen. A spectator page: no desk, so no telex, sheet, machine, race card, tray,
 * Abandon or input. One full-viewport frame on the paper ground: the stage (the scene or the ring, the
 * plaque layer, the kicker and the live state) and the top-10 sidebar on the right, everything at the
 * projector scale. One race store around it, fed by `ProjectorLive`'s spectator socket; the rank plaques
 * (C4, C5) over the stage, placed from the scene's anchors (none on paper: every plaque stays hidden).
 */
export function ProjectorScreen({ seat, labels, mint, stage }: ProjectorScreenProps) {
  return (
    <RaceStoreProvider>
      <PlaqueAnchorsProvider>
        <div data-projector className={styles.screen}>
          <div data-projector-stage className={styles.stage}>
            {stage}
          </div>
          <div data-plaques aria-hidden="true" className={styles.plaques}>
            <RankPlaquesLive labels={labels.projector} />
          </div>
          <div className={styles.main}>
            <h1 className={styles.kicker}>{labels.projector.kicker}</h1>
            <div data-projector-status className={styles.status}>
              <ProjectorLive code={seat.code} lobbyId={seat.lobbyId} mint={mint} labels={labels} />
            </div>
          </div>
          <div className={styles.side}>
            <Top10Live labels={labels} />
          </div>
        </div>
      </PlaqueAnchorsProvider>
    </RaceStoreProvider>
  );
}
