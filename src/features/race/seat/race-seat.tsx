import type { ReactNode } from "react";
import type { MintRaceToken } from "../client/connect-seat";
import { RaceStoreProvider } from "../client/use-race-store";
import { SabotageTrayLive } from "../components/sabotage-tray-live";
import { SeatLayout } from "../components/seat-layout";
import type { MachineSkinId, MachineSkinProps } from "../components/machine/skin";
import { TypingMachineLive } from "../components/machine/typing-machine-live";
import { NixieCountersLive } from "../components/nixie-counters-live";
import type { RaceSeatInfo } from "../queries/get-race-seat";
import { RaceSeatLive } from "./race-seat-live";
import { SeatSound, type SaveSound } from "./seat-sound";
import { SeatFrame } from "./seat-frame";
import { SeatAbandon, SeatKicker, SeatRaceCard, SeatSheet, SeatTelex } from "./seat-leaves";
import type { RaceSeatLabels } from "./seat-view";

export type RaceSeatProps = {
  /** The room behind the page (`getRaceSeat`). */
  seat: RaceSeatInfo;
  /** The `race` catalog of the request's language (ADR 0010). */
  labels: RaceSeatLabels;
  /** The lobby's `mintRaceToken` action, passed by the route. */
  mint: MintRaceToken;
  /** The machine's keys: the viewer's keyboard layout, chosen by the route (#224, `machineRows`). */
  rows: MachineSkinProps["rows"];
  /** The machine's look: the viewer's filed skin (#638); the teleprinter by default. */
  skin?: MachineSkinId;
  /** The viewer's filed `sound` (#243, `getPreferences`): false (muted) by default. */
  sound?: boolean;
  /** The identity feature's `updatePreferences`, passed by the route (#243): the toggle files through it. */
  saveSound?: SaveSound;
  /** The 3D seat scene (#563): the route's client leaf, which loads race-3d lazily after the HUD. */
  scene?: ReactNode;
};

/**
 * `/race/[raceId]` (#561, ARCHITECTURE 8.1, 8.3, ADR 0013): the seat view's HTML layer, rendered on the
 * server in its before-start state (the telex, the typed sheet out of the teleprinter, the nixie
 * counters, the race card, the Sabotage tray, Abandon and the kicker), with one race store around it.
 * The client leaf `RaceSeatLive` then connects and every HUD leaf follows the store. No server-only
 * import: the race feature's index stays importable from client modules; the route reads the seat and
 * the catalog and passes the lobby's action down.
 */
export function RaceSeat({
  seat,
  labels,
  mint,
  rows,
  skin,
  sound = false,
  saveSound,
  scene,
}: RaceSeatProps) {
  return (
    <RaceStoreProvider>
      <SeatLayout
        kicker={<SeatKicker labels={labels.kicker} />}
        nixie={<NixieCountersLive labels={labels.counters} />}
        telex={<SeatTelex labels={labels.telex} />}
        raceCard={<SeatRaceCard labels={labels.raceCard} />}
        scene={scene}
        status={
          <RaceSeatLive
            code={seat.code}
            lobbyId={seat.lobbyId}
            mint={mint}
            labels={{
              loading: labels.loading,
              notice: labels.notice,
              errors: labels.errors,
              presence: labels.presence,
              countdown: labels.countdown,
              stamps: labels.stamps,
              announce: labels.announce,
              finish: labels.finish,
              exit: labels.exit,
              input: labels.telex.strip,
            }}
          />
        }
        sheet={<SeatSheet />}
        machine={<TypingMachineLive rows={rows} skin={skin} />}
        tray={<SabotageTrayLive labels={labels.sabotageTray} />}
        abandon={<SeatAbandon labels={labels.abandon} />}
        sound={
          saveSound ? <SeatSound initial={sound} save={saveSound} labels={labels.sound} /> : null
        }
        phones={labels.notice.phones}
        frame={SeatFrame}
      />
    </RaceStoreProvider>
  );
}
