"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { connectSeat, type MintRaceToken } from "../client/connect-seat";
import {
  selectCanType,
  selectExit,
  selectVisibleStamp,
  sendAbandons,
  sendBonusPlays,
  watchBlurExpiry,
  watchRefusalExpiry,
  watchStampExpiry,
  type RaceLostReason,
  type RacePhase,
} from "../client/store";
import { createTyping, type Typing } from "../client/typing";
import { useRaceStore, useRaceStoreApi } from "../client/use-race-store";
import {
  atGo,
  Countdown,
  countdownStep,
  nextStepIn,
  type CountdownStep,
} from "../components/countdown";
import docket from "../components/hud-docket.module.css";
import notice from "../components/race-notice.module.css";
import { AsleepAtDesk } from "../components/asleep-at-desk";
import { RaceInput } from "../components/race-input";
import { ReassignedNotice } from "../components/reassigned-notice";
import { FinishedView } from "../components/finished-view";
import { nixieNumber } from "../components/nixie-counters";
import { RaceNotice } from "../components/race-notice";
import { RaceAnnouncer } from "../components/race-announcer";
import { StampRow } from "../components/stamp-row";
import { selectAccuracy, selectFinishWpm, selectPlace } from "../view/counters";
import type { ExitLabels } from "../view/hud-labels";
import { finalRows, liveRows, selectStandings, type FinishLabels } from "../view/standings";
import { PHONE_QUERY, type RaceSeatLabels, type SeatErrorLabels } from "./seat-view";
import styles from "./race-seat.module.css";

export type SeatStatusLabels = Pick<RaceSeatLabels, "loading" | "notice" | "errors" | "presence">;

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
  // The lost room shows its own notice row (#235 C4); this sentence is never read.
  "room-lost": "noRoom",
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
 * back to the waiting room (7.4 inline error line); the lost room (#235 C4) as the still notice row
 * `THE ROOM WAS LOST · BACK TO THE LOBBY`, its link to `/lobby/[code]`. Countdown and the GO stamp are `RaceSeatLive`'s
 * (#214, they follow the clock); after your finish and at RACE OVER the finished view is `SeatFinish`'s
 * (#240, it follows the snapshots): nothing here.
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
      if (lost === "room-lost") {
        return (
          <div data-lost="room-lost" className={styles.lost}>
            {/* a statement, not a live state: the notice row without its pulse (bible 7.4) */}
            <p
              role="alert"
              data-notice="room-lost"
              className={cn(docket.notice, notice.notice, styles.roomLost)}
            >
              {labels.presence.roomLost} ·{" "}
              <a href={`/lobby/${code}`} className={styles.roomLink}>
                {labels.presence.backToLobby}
              </a>
            </p>
          </div>
        );
      }
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
  return live ? atGo(step, phase) : null;
}

/**
 * The overtake stamps' copy and the announcer's race lines (#232), the finished view's (#240), the exit
 * dockets' (#233).
 */
export type SeatStampLabels = Pick<RaceSeatLabels, "stamps" | "announce" | "finish" | "exit">;

/**
 * The exit docket over the store (#233 C3, C4): after the server took your ABANDON, the Reassigned notice;
 * after its idle kick, Asleep at desk; each with your partial stats frozen at your last key (the engine's
 * WPM and accuracy over your predicted state, ADR 0007), until KEEP WATCHING closes it (the HUD stays live,
 * without input) or RACE OVER yields to the finished view. A reload finds it again (`selectExit` reads the
 * server's status too).
 */
export function SeatExit({ code, labels }: { code: string; labels: ExitLabels }) {
  const store = useRaceStoreApi();
  const exit = useRaceStore(selectExit);
  const wpm = useRaceStore(selectFinishWpm);
  const accuracy = useRaceStore((s) => selectAccuracy(s) ?? 100);
  const keepWatching = useCallback(() => store.dispatch({ type: "exit-dismissed" }), [store]);
  if (exit === null) return null;
  const Docket = exit === "abandoned" ? ReassignedNotice : AsleepAtDesk;
  return (
    <Docket
      wpm={wpm}
      accuracy={accuracy}
      leaveHref={`/lobby/${code}`}
      onKeepWatching={keepWatching}
      labels={labels}
    />
  );
}

/**
 * The idle warning (#233 C4, bible 7.4 notice row): the urgent notice `THE MAJOR IS LOOKING AT YOU.
 * TYPE.` while the race runs and the server warned your silent desk; your next key clears it.
 */
export function SeatIdleNotice({ labels }: { labels: SeatStatusLabels["notice"] }) {
  const warned = useRaceStore((s) => s.phase === "running" && s.idleWarning);
  return warned ? <RaceNotice kind="idle-warning" labels={labels} /> : null;
}

/**
 * The finished view over the store (#240 C2, C3): after your finish while the race runs, the `FILED`
 * docket with your provisional place (`01 / 02`, from `ranks`) and the live standings (every desk by
 * rank, one view per snapshot); once the server ended the race, the `RACE OVER` docket with its reason,
 * the final ranking as sent and the `DAWN REPORT →` link to `/results/<raceId>`, also when nobody
 * finished or a reload found the room ended (no ranking then). A `void` end is #661's lost-room notice:
 * nothing here. Each read is a primitive or a memoised view, so a key re-renders nothing.
 */
export function SeatFinish({ labels }: { labels: FinishLabels }) {
  const phase = useRaceStore((s) => s.phase);
  const finished = useRaceStore((s) => s.prediction?.state.status === "finished");
  const you = useRaceStore((s) => s.you);
  const place = useRaceStore((s) => selectPlace(s).place);
  const total = useRaceStore((s) => selectPlace(s).total);
  const standings = useRaceStore(selectStandings);
  const ending = useRaceStore((s) => s.ending);
  const raceId = useRaceStore((s) => s.race?.raceId ?? null);
  if (phase === "ended") {
    if (ending?.reason === "void") return null;
    const id = ending?.raceId ?? raceId;
    return (
      <FinishedView
        mode="ended"
        value={ending ? labels.reason[ending.reason] : null}
        rows={ending ? finalRows(ending.ranking, ending.reason, you, labels) : []}
        report={id === null ? null : `/results/${id}`}
        labels={labels}
      />
    );
  }
  if (phase !== "running" || !finished) return null;
  return (
    <FinishedView
      mode="finished"
      value={place === 0 ? null : `${nixieNumber(place)} / ${nixieNumber(total)}`}
      rows={liveRows(standings, labels)}
      report={null}
      labels={labels}
    />
  );
}

/**
 * The seat view's client leaf (#561 C4, ARCHITECTURE 8.3): after the server rendered the HUD shell, it
 * mints the race token through the lobby action, connects with `connectToRoom` (lazily loaded) and feeds
 * the one race store every HUD leaf reads; it renders the live state. Phones only watch (the layout shows
 * them the notice; spectator mode is #292), so a phone-width page never takes a desk.
 * Its root carries the store's phase as `data-phase` (`countdown` until GO, `running` from GO: the gate
 * #559's input reads) and holds the countdown overlay and the race's one polite announcer (#242: 3, 2,
 * 1, GO of #214, the overtake lines of #232, your place, your finish, the race over). It owns the typing path too (#559): the hidden `RaceInput`,
 * unlocked while you may type, feeds `createTyping` over the open socket. A bare Enter there plays your
 * Sabotage card (#236): the store takes the play when it may go out and `sendBonusPlays` emits it.
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
  const finishWpm = useRaceStore(selectFinishWpm);
  const { announce, countdown, stamps } = labels;
  const announcer = useMemo(() => ({ announce, countdown, stamps }), [announce, countdown, stamps]);
  const typing = useRef<Typing | null>(null);
  const press = useCallback((key: string) => typing.current?.press(key), []);
  // #236: Enter plays your card; the store gates it and `sendBonusPlays` sends it
  const play = useCallback(() => store.dispatch({ type: "bonus-play", at: Date.now() }), [store]);
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
        const stopPlays = sendBonusPlays(store, socket);
        // #233: one `abandon` per confirm the store took
        const stopAbandons = sendAbandons(store, socket);
        return () => {
          stopPlays();
          stopAbandons();
          own.dispose();
          if (typing.current === own) typing.current = null;
        };
      },
    });
  }, [code, lobbyId, store]);
  // #232: the visible overtake stamp leaves 1.4 s after it shows
  useEffect(() => watchStampExpiry(store), [store]);
  // #236: the IMMUNE row leaves 1.2 s after the refusal; a Smoke Break's blur lifts at its end
  useEffect(() => watchRefusalExpiry(store), [store]);
  useEffect(() => watchBlurExpiry(store), [store]);

  return (
    <div data-phase={phase} className={styles.live}>
      <RaceSeatLiveView phase={phase} lost={lost} code={code} labels={labels} />
      <SeatIdleNotice labels={labels.notice} />
      <SeatExit code={code} labels={labels.exit} />
      <SeatFinish labels={labels.finish} />
      {/* bible 8: one stamp at a time; the countdown and GO first, then the overtake stamps (#232) */}
      {step !== null ? (
        <Countdown step={step} labels={labels.countdown} />
      ) : (
        <StampRow stamp={stamp} wpm={finishWpm} labels={labels.stamps} />
      )}
      <RaceInput
        disabled={!canType}
        onKey={press}
        onPlay={play}
        label={labels.input}
        mode={mode}
        backspace={backspace}
        errors={errors}
      />
      {/* #242: the one polite announcer, present before the countdown starts so each change is read;
          nothing to say once lost (the lost line is its own alert) */}
      {phase !== "lost" ? <RaceAnnouncer step={step} labels={announcer} /> : null}
    </div>
  );
}
