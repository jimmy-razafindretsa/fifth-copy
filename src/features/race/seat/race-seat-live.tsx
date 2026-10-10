"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { connectSeat, type MintRaceToken } from "../client/connect-seat";
import type { RaceLostReason, RacePhase } from "../client/store";
import { useRaceStore, useRaceStoreApi } from "../client/use-race-store";
import docket from "../components/hud-docket.module.css";
import { RaceNotice } from "../components/race-notice";
import { PHONE_QUERY, type RaceSeatLabels, type SeatErrorLabels } from "./seat-view";
import styles from "./race-seat.module.css";

export type SeatStatusLabels = Pick<RaceSeatLabels, "loading" | "notice" | "errors">;

const LOST_COPY: Record<RaceLostReason, keyof Omit<SeatErrorLabels, "prefix" | "back">> = {
  closed: "closed",
  "no-room": "noRoom",
  "in-progress": "inProgress",
  "not-found": "notFound",
  "bad-token": "generic",
  version: "generic",
  generic: "generic",
};

type ViewProps = {
  phase: RacePhase;
  lost: RaceLostReason | null;
  code: string;
  labels: SeatStatusLabels;
};

/**
 * The seat's live state for one phase (no hooks, so every phase renders in tests): skeleton rows while
 * connecting (bible 7.4), the waiting and line-cut notices (7.4 notice row), the lost line with the way
 * back to the waiting room (7.4 inline error line). Countdown, running and ended belong to #214, #559
 * and #240: nothing here yet.
 */
export function RaceSeatLiveView({ phase, lost, code, labels }: ViewProps) {
  switch (phase) {
    case "connecting":
      return (
        <div data-skeleton className={docket.docket}>
          <ul aria-busy="true" aria-label={labels.loading} className={styles.skeleton}>
            {[0, 1].map((i) => (
              <li key={i} aria-hidden="true" className={docket.row}>
                <span className={styles.block} />
                <span className={cn(styles.block, styles.blockWide)} />
              </li>
            ))}
          </ul>
          <p className={docket.srOnly}>{labels.loading}</p>
        </div>
      );
    case "waiting":
      return <RaceNotice kind="waiting-for-host" labels={labels.notice} />;
    case "reconnecting":
      return <RaceNotice kind="reconnecting" labels={labels.notice} />;
    case "lost":
      return (
        <div data-lost={lost ?? "generic"} className={styles.lost}>
          <p role="alert" className={styles.errorLine}>
            <span className={styles.errorPrefix}>{labels.errors.prefix}</span>{" "}
            {labels.errors[LOST_COPY[lost ?? "generic"]]}
          </p>
          {/* a full page load: after a version refusal the waiting room fetches the new bundle */}
          <a href={`/lobby/${code}`} className={styles.back}>
            {labels.errors.back}
          </a>
        </div>
      );
    default:
      return null;
  }
}

/**
 * The seat view's client leaf (#561 C4, ARCHITECTURE 8.3): after the server rendered the HUD shell, it
 * mints the race token through the lobby action, connects with `connectToRoom` (lazily loaded) and feeds
 * the one race store every HUD leaf reads; it renders the live state. Phones only watch (the layout shows
 * them the notice; spectator mode is #292), so a phone-width page never takes a desk.
 */
export function RaceSeatLive({
  code,
  lobbyId,
  mint,
  labels,
}: {
  code: string;
  lobbyId: string;
  mint: MintRaceToken;
  labels: SeatStatusLabels;
}) {
  const store = useRaceStoreApi();
  const phase = useRaceStore((s) => s.phase);
  const lost = useRaceStore((s) => s.lost);
  // The action reference changes on every refresh of the route's payload (the mint's first visit sets the
  // guest cookie, and a cookie set in an action re-renders the page): read the latest one, never reconnect
  // for it.
  const mintRef = useRef(mint);
  useEffect(() => {
    mintRef.current = mint;
  }, [mint]);

  useEffect(() => {
    if (window.matchMedia(PHONE_QUERY).matches) return;
    return connectSeat({
      code,
      lobbyId,
      mint: (input) => mintRef.current(input),
      dispatch: store.dispatch,
    });
  }, [code, lobbyId, store]);

  return <RaceSeatLiveView phase={phase} lost={lost} code={code} labels={labels} />;
}
