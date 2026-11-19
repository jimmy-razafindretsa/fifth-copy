import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { MintRaceToken } from "../../client/connect-seat";
import { RaceStoreProvider } from "../../client/use-race-store";
import docket from "../../components/hud-docket.module.css";
import notice from "../../components/race-notice.module.css";
import { ProjectorLive, Top10Live, type ProjectorScreenLabels } from "./projector-live";
import styles from "./phone-screen.module.css";

/** The phone spectator's copy: the projector's, plus its kicker and the phones statement. */
export type PhoneScreenLabels = ProjectorScreenLabels & {
  phone: { kicker: string };
  notice: { phones: string };
};

export type PhoneScreenProps = {
  /** The room behind the page, as the projector gets it (`code: null` on a spectator link's page). */
  seat: { code: string | null; lobbyId: string };
  labels: PhoneScreenLabels;
  /** The lobby's `mintRaceToken` (or a spectator link's bound `mintSpectatorToken`). */
  mint: MintRaceToken;
  /**
   * `false` for the room's host (#999 C14): its own player token, as the watching host of #876 (no desk);
   * anyone else watches on a `spectator` token.
   */
  spectator?: boolean;
  /** The compact overview (#999 C10): the route's ring leaf (the lobby's CSS seat ring, no `you`). */
  ring?: ReactNode;
};

/**
 * The phone spectator screen (#999 C9, C10, C11; bible 14.3 "Phone spectator", 18; ARCHITECTURE 7.8):
 * what a phone (480px and under) gets on `/race/<id>` or a watch link, in place of a desk. The watch
 * family's second screen, the projector view in one column at the phone's scale: no site header, no
 * desk, so no telex, sheet, machine, race card, tray, Abandon or input, and never a `keys` or `ready`.
 * Top to bottom: the kicker, the phones statement row, the live state (the projector's: skeleton,
 * WAITING FOR THE HOST, the loading card with READY, 3-2-1 and GO, nothing while racing, RACE OVER with
 * the Dawn report link, the cut line, the lost room), the standings (the top 10 with rival markers, the
 * final WPM at RACE OVER) and the seat ring diagram (no three.js on phones). No horizontal scroll from
 * 320px. One race store, fed by `ProjectorLive`.
 */
export function PhoneScreen({ seat, labels, mint, spectator = true, ring }: PhoneScreenProps) {
  return (
    <RaceStoreProvider>
      <div data-phone-screen className={styles.screen}>
        <h1 className={styles.kicker}>{labels.phone.kicker}</h1>
        <p data-notice="phones" className={cn(docket.notice, notice.notice)}>
          {labels.notice.phones}
        </p>
        <div data-projector-status className={styles.status}>
          <ProjectorLive
            code={seat.code}
            lobbyId={seat.lobbyId}
            mint={mint}
            labels={labels}
            spectator={spectator}
          />
        </div>
        <Top10Live labels={labels} compact />
        {ring ? (
          <div data-phone-ring className={styles.ring}>
            {ring}
          </div>
        ) : null}
      </div>
    </RaceStoreProvider>
  );
}
