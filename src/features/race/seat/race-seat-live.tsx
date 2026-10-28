"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fill } from "@/i18n/format";
import { cn } from "@/lib/cn";
import { connectSeat, type MintRaceToken } from "../client/connect-seat";
import {
  selectCanType,
  selectVisibleStamp,
  watchStampExpiry,
  type RaceLostReason,
  type RacePhase,
} from "../client/store";
import { createTyping, type Typing } from "../client/typing";
import { useRaceStore, useRaceStoreApi } from "../client/use-race-store";
import { Countdown, countdownStep, nextStepIn, type CountdownStep } from "../components/countdown";
import docket from "../components/hud-docket.module.css";
import { RaceInput } from "../components/race-input";
import { RaceNotice } from "../components/race-notice";
import { StampRow } from "../components/stamp-row";
import { SeatDesks } from "./seat-leaves";
import { paperwork, PHONE_QUERY, type RaceSeatLabels, type SeatErrorLabels } from "./seat-view";
import styles from "./race-seat.module.css";

export type SeatStatusLabels = Pick<RaceSeatLabels, "loading" | "notice" | "errors">;

/** The live leaf's copy: the status slot's, the countdown's (#214) and the typing input's name (#559). */
export type SeatLiveLabels = SeatStatusLabels &
  Pick<RaceSeatLabels, "countdown"> & {
    input: string;
  };

const LOST_COPY: Record<RaceLostReason, keyof Omit<SeatErrorLabels, "prefix" | "back">> = {
  closed: "closed",
  "no-room": "noRoom",
  "in-progress": "inProgress",
  "not-found": "notFound",
  "bad-token": "generic",
  version: "generic",
  // A spectator past the room's cap (#616): no dedicated copy yet.
  "room-full": "generic",
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
 * back to the waiting room (7.4 inline error line). Countdown and the GO stamp are `RaceSeatLive`'s
 * (#214, they follow the clock); running and ended belong to #559 and #240: nothing here.
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
 * The countdown's step on the corrected clock (#214 C3): `3`, `2`, `1`, the GO stamp, then nothing
 * `GO_STAMP_MS` after GO. One timeout per step change; the store's GO (`bindRaceSocket`) reads the same
 * `race.t0` and offset, so the phase turns `running` as the stamp lands.
 */
function useCountdownStep(): CountdownStep | null {
  const phase = useRaceStore((s) => s.phase);
  const t0 = useRaceStore((s) => s.race?.t0 ?? null);
  const offset = useRaceStore((s) => s.clockOffset);
  const live = (phase === "countdown" || phase === "running") && t0 !== null;
  const [step, setStep] = useState<CountdownStep | null>(null);
  useEffect(() => {
    if (!live || t0 === null) return;
    let handle: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const msToGo = t0 - (Date.now() + offset);
      setStep(countdownStep(msToGo));
      const next = nextStepIn(msToGo);
      if (next !== null) handle = setTimeout(tick, next);
    };
    handle = setTimeout(tick, 0);
    return () => clearTimeout(handle);
  }, [live, t0, offset]);
  return live ? step : null;
}

/** The overtake stamps' copy and the announcer's race lines (#232). */
export type SeatStampLabels = Pick<RaceSeatLabels, "stamps" | "announce">;

/**
 * The seat view's client leaf (#561 C4, ARCHITECTURE 8.3): after the server rendered the HUD shell, it
 * mints the race token through the lobby action, connects with `connectToRoom` (lazily loaded) and feeds
 * the one race store every HUD leaf reads; it renders the live state. Phones only watch (the layout shows
 * them the notice; spectator mode is #292), so a phone-width page never takes a desk.
 * Its root carries the store's phase as `data-phase` (`countdown` until GO, `running` from GO: the gate
 * #559's input reads) and holds the countdown overlay and the polite announcer of 3, 2, 1, GO (#214;
 * the race announcer of #242 reuses it). It owns the typing path too (#559): the hidden `RaceInput`,
 * unlocked while you may type, feeds `createTyping` over the open socket.
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
  labels: SeatLiveLabels & SeatStampLabels;
}) {
  const store = useRaceStoreApi();
  const phase = useRaceStore((s) => s.phase);
  const lost = useRaceStore((s) => s.lost);
  const step = useCountdownStep();
  const stamp = useRaceStore(selectVisibleStamp);
  const canType = useRaceStore(selectCanType);
  const mode = useRaceStore((s) => s.settings?.errorMode);
  const backspace = useRaceStore((s) => s.settings?.backspace);
  const errors = useRaceStore((s) => s.prediction?.state.errors);
  const typing = useRef<Typing | null>(null);
  const press = useCallback((key: string) => typing.current?.press(key), []);
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
      onSocket: (socket) => {
        const own = createTyping({ store, send: (batch) => socket.sendKeys(batch) });
        typing.current = own;
        return () => {
          own.dispose();
          if (typing.current === own) typing.current = null;
        };
      },
    });
  }, [code, lobbyId, store]);
  // #232: the visible overtake stamp leaves 1.4 s after it shows
  useEffect(() => watchStampExpiry(store), [store]);

  return (
    <div data-phase={phase} className={styles.live}>
      <RaceSeatLiveView phase={phase} lost={lost} code={code} labels={labels} />
      {/* bible 8: one stamp at a time; the countdown and GO first, then the overtake stamps (#232) */}
      {step !== null ? (
        <Countdown step={step} labels={labels.countdown} />
      ) : (
        <StampRow stamp={stamp} labels={labels.stamps} />
      )}
      <RaceInput
        disabled={!canType}
        onKey={press}
        label={labels.input}
        mode={mode}
        backspace={backspace}
        errors={errors}
      />
      <SeatDesks />
      {/* present before the countdown starts, so each change is announced; nothing to say once lost */}
      {phase !== "lost" ? (
        <p role="status" aria-atomic="true" data-announcer className={docket.srOnly}>
          {step !== null
            ? step === "go"
              ? labels.countdown.go
              : String(step)
            : stamp
              ? fill(labels.announce[stamp.kind], { desk: paperwork(stamp.other) })
              : ""}
        </p>
      ) : null}
    </div>
  );
}
