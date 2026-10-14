import type { MintRaceToken } from "../client/connect-seat";
import { RaceStoreProvider } from "../client/use-race-store";
import { SabotageTray } from "../components/sabotage-tray";
import { SeatLayout } from "../components/seat-layout";
import { TelexStrip } from "../components/telex-strip";
import { TypedSheet } from "../components/typed-sheet";
import { TypingMachine } from "../components/machine/typing-machine";
import type { RaceSeatInfo } from "../queries/get-race-seat";
import { RaceSeatLive } from "./race-seat-live";
import { SeatAbandon, SeatKicker, SeatNixie, SeatRaceCard } from "./seat-leaves";
import { BEFORE_START_VIEW, SEAT_ROWS, type RaceSeatLabels } from "./seat-view";

export type RaceSeatProps = {
  /** The room behind the page (`getRaceSeat`). */
  seat: RaceSeatInfo;
  /** The `race` catalog of the request's language (ADR 0010). */
  labels: RaceSeatLabels;
  /** The lobby's `mintRaceToken` action, passed by the route. */
  mint: MintRaceToken;
};

/**
 * `/race/[raceId]` (#561, ARCHITECTURE 8.1, 8.3, ADR 0013): the seat view's HTML layer, rendered on the
 * server in its before-start state (the telex, the typed sheet out of the teleprinter, the nixie
 * counters, the race card, the Sabotage tray, Abandon and the kicker), with one race store around it.
 * The client leaf `RaceSeatLive` then connects and every HUD leaf follows the store. No server-only
 * import: the race feature's index stays importable from client modules; the route reads the seat and
 * the catalog and passes the lobby's action down.
 */
export function RaceSeat({ seat, labels, mint }: RaceSeatProps) {
  return (
    <RaceStoreProvider>
      <SeatLayout
        kicker={<SeatKicker labels={labels.kicker} />}
        nixie={<SeatNixie labels={labels.nixie} />}
        telex={<TelexStrip view={BEFORE_START_VIEW} labels={labels.telex} />}
        raceCard={<SeatRaceCard labels={labels.raceCard} />}
        status={
          <RaceSeatLive
            code={seat.code}
            lobbyId={seat.lobbyId}
            mint={mint}
            labels={{ loading: labels.loading, notice: labels.notice, errors: labels.errors }}
          />
        }
        sheet={<TypedSheet view={BEFORE_START_VIEW} />}
        machine={<TypingMachine rows={SEAT_ROWS} />}
        tray={<SabotageTray card={null} cooldownS={0} hint={null} labels={labels.sabotageTray} />}
        abandon={<SeatAbandon labels={labels.abandon} />}
        phones={labels.notice.phones}
      />
    </RaceStoreProvider>
  );
}
