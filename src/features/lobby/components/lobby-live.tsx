"use client";

import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import type { RoomSocket } from "@/features/race";
import { mintRaceToken } from "../actions/mint-race-token";
import { setLobbyType } from "../actions/set-lobby-type";
import { errorMessage, type EntryErrors } from "./entry-errors";
import { InlineError } from "./inline-error";
import { joinRoom } from "./late-join";
import { playersLabel, type LobbyLabels } from "./lobby-labels";
import {
  bindRoomSocket,
  initialLobbyState,
  lobbyErrorCopy,
  reduceLobby,
  ROOM_SEATS,
  type LobbyState,
} from "./lobby-store";
import { PlayerList, PlayerListSkeleton } from "./player-list";
import { SeatRing } from "./seat-ring";
import { InviteDocket } from "./invite-docket";
import { ROOM_CODE_ID, RoomCodeDocket } from "./room-code-docket";
import { hostForm } from "./settings-controls";
import { SettingsDocket } from "./settings-docket";
import {
  IDLE_FORM,
  reduceForm,
  submitLobbyType,
  submitSetting,
  type FormEvent,
  type FormKey,
  type FormState,
  type LobbyKind,
  type RawValue,
} from "./settings-form";
import { StartControl, type StartError } from "./start-control";
import styles from "./lobby.module.css";

/** The host's START between the click and the countdown (#214 C8); `hidden` after a `not-host` ack. */
export type StartState = { pending: boolean; error: StartError | null; hidden: boolean };

const IDLE_START: StartState = { pending: false, error: null, hidden: false };

type ViewProps = {
  code: string;
  state: LobbyState;
  /**
   * The lobby's visibility from its row (`Lobby.type`, #114): Postgres owns it (ADR 0008), so it wins
   * over the room's copy in the settings; absent, the room's copy shows.
   */
  lobbyType?: LobbyKind;
  labels: LobbyLabels;
  errors: EntryErrors;
  start?: StartState;
  onStart?: () => void;
  /** The host's settings form (#110): its state, the refusal count that resets its inputs, its changes. */
  form?: FormState;
  revision?: number;
  onSetting?: (key: FormKey, raw: RawValue) => void;
  /**
   * The host's `PASSWORD RESET` docket (#790), rendered by the server page for the lobby's teacher host
   * only (never hidden here): placed under the settings docket, above START.
   */
  reset?: ReactNode;
};

/** The viewer's own row says whether they host (`Member.isHost`, protocol v4). */
const isHost = (state: LobbyState) => state.members.some((m) => m.desk === state.you && m.isHost);

/**
 * The waiting room's layout for one lobby state (no hooks, so every state renders in tests; #498, bible
 * 14.3): the dockets column (the room docket with its invite rows, the `FORM 5-L` settings docket, the
 * host's START under it) beside the seat ring (#731) and the roll. Phones keep the room docket, the roll
 * and START (CSS).
 */
export function LobbyLiveView({
  code,
  state: room,
  lobbyType,
  labels,
  errors,
  start = IDLE_START,
  onStart,
  form = IDLE_FORM,
  revision = 0,
  onSetting,
  reset = null,
}: ViewProps) {
  const state: LobbyState =
    room.settings && lobbyType ? { ...room, settings: { ...room.settings, lobbyType } } : room;
  const known =
    state.phase === "live" || state.phase === "reconnecting" || state.phase === "starting";
  const canStart = (state.phase === "live" || state.phase === "starting") && isHost(state);
  // a non-host waits for the host's START: a statement row, so it does not pulse (bible 7.4, #105)
  const waitsForHost = known && state.phase !== "starting" && !isHost(state);
  // the host edits while the room is live and waiting; `not-host` (form hidden) falls back to the rows
  const edits =
    state.phase === "live" && state.settings && isHost(state) && form.status !== "hidden"
      ? hostForm({
          settings: state.settings,
          labels: labels.settings,
          form,
          revision,
          seated: state.members.length,
          prefix: errors.prefix,
          onChange: onSetting,
        })
      : null;
  return (
    <div className={styles.room}>
      <div className={styles.dockets}>
        <RoomCodeDocket
          code={code}
          count={known ? state.members.length : null}
          seats={ROOM_SEATS}
          labels={labels}
        >
          <InviteDocket code={code} codeId={ROOM_CODE_ID} labels={labels.invite} />
        </RoomCodeDocket>
        {state.phase === "error" ? null : (
          <SettingsDocket settings={state.settings} labels={labels.settings} {...edits} />
        )}
        {reset}
        {canStart && !start.hidden ? (
          <StartControl
            seated={state.members.length}
            pending={start.pending || state.phase === "starting"}
            error={start.error}
            labels={labels.start}
            prefix={errors.prefix}
            onStart={onStart}
          />
        ) : null}
      </div>
      <div className={styles.side}>
        {/* the seat ring diagram (#731): drawn once the roster is known, empty (no room) before */}
        <div className={styles.ring}>
          {known ? (
            <SeatRing
              members={state.members}
              you={state.you}
              seats={ROOM_SEATS}
              labels={labels.ring}
            />
          ) : null}
        </div>
        <div className={styles.roll}>
          {state.phase === "reconnecting" ? (
            <p role="status" className={cn(styles.notice, styles.pulse)}>
              {labels.reconnecting}
            </p>
          ) : null}
          {waitsForHost ? (
            <p role="status" className={styles.notice}>
              {labels.waitingForHost}
            </p>
          ) : null}
          {/* a late joiner (#732): a statement row, so it does not pulse (bible 7.4, 14.3) */}
          {state.phase === "spectating" ? (
            <p role="status" className={styles.notice}>
              {labels.raceInProgress}
            </p>
          ) : null}
          {state.phase === "loading" || state.phase === "spectating" ? (
            <PlayerListSkeleton labels={labels} />
          ) : null}
          {known ? <PlayerList members={state.members} you={state.you} labels={labels} /> : null}
          {state.phase === "error" ? (
            <div className={styles.error}>
              <InlineError prefix={errors.prefix}>
                {errorMessage(errors, lobbyErrorCopy(state.error))}
              </InlineError>
            </div>
          ) : null}
          <p aria-live="polite" className={styles.srOnly}>
            {known ? playersLabel(labels, state.members.length) : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The waiting room's client leaf (ARCHITECTURE 8.3): mints the race token through the action (ADR
 * 0009: never in a URL, the HTML or a cookie), connects through a lazily loaded `connectToRoom` (ADR
 * 0006, 0013) and keeps the roster in one store that later cards extend with more events. A viewer
 * who arrives after START is held by `joinRoom` (#732) and seated when the race ends. Every welcome
 * stores the desk's resume key for the seat view. The host's START sends `host:start`; the `countdown`
 * that follows moves every member to `/race/<raceId>` once (#214), and the socket is parked for the seat
 * view instead of closed, so the desk is never line-cut while that page connects.
 */
export function LobbyLive({
  code,
  lobbyId,
  lobbyType,
  labels,
  errors,
  reset,
}: {
  code: string;
  /** The room's lobby id (`Lobby.id`): the resume key and the parked socket are keyed by it. */
  lobbyId: string;
  /** `Lobby.type` as the server rendered it; `setLobbyType` revalidates the page, which renews it. */
  lobbyType: LobbyKind;
  labels: LobbyLabels;
  errors: EntryErrors;
  /** The server-rendered reset docket slot (#790), passed through to the view. */
  reset?: ReactNode;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reduceLobby, initialLobbyState);
  const [start, setStart] = useState<StartState>(IDLE_START);
  const [form, setForm] = useState<FormState>(IDLE_FORM);
  const [revision, setRevision] = useState(0);
  // the form's state without waiting for a render: a blur and a click in one tick send one patch
  const formRef = useRef<FormState>(IDLE_FORM);
  const socketRef = useRef<RoomSocket | null>(null);
  // set once the page moves to the seat view: the cleanup then parks the socket instead of closing it
  const handedOver = useRef(false);

  useEffect(() => {
    // StrictMode runs this twice in dev: a cancelled join never opens a socket.
    let socket: RoomSocket | null = null;
    let unbind = () => {};
    let race: typeof import("@/features/race") | null = null;
    // The socket module (socket.io-client + protocol schemas) is a lazy chunk (ADR 0013 budget):
    // its download overlaps the first mint round trip, and a failed chunk load is a generic error.
    const raceModule = import("@/features/race");
    const cancel = joinRoom({
      mint: ({ spectator }) => mintRaceToken({ code, spectator }),
      connect: async (url, token) => {
        race = await raceModule;
        return race.connectToRoom(url, token);
      },
      attach: (seat) => {
        socket = seat;
        socketRef.current = seat;
        const off = bindRoomSocket(seat, dispatch, {
          lobbyId,
          storeResumeKey: race?.storeResumeKey,
        });
        unbind = off;
        return () => {
          off();
          if (socket !== seat) return;
          socket = null;
          socketRef.current = null;
          unbind = () => {};
        };
      },
      dispatch,
    });
    return () => {
      cancel();
      unbind();
      socketRef.current = null;
      if (socket && handedOver.current && race) race.parkSocket(lobbyId, socket);
      else socket?.close();
    };
  }, [code, lobbyId]);

  // The countdown moves the page to the seat view of the started race, once.
  useEffect(() => {
    if (state.phase !== "starting" || !state.raceId || handedOver.current) return;
    handedOver.current = true;
    router.replace(`/race/${encodeURIComponent(state.raceId)}`);
  }, [state.phase, state.raceId, router]);

  async function onStart() {
    const socket = socketRef.current;
    if (!socket || start.pending) return;
    setStart({ pending: true, error: null, hidden: false });
    const ack = await socket.sendHostStart();
    // ok: the countdown (sent before the ack) is already moving the page; stay busy until it does
    if (ack.ok) return;
    setStart(
      ack.error === "not-host"
        ? { pending: false, error: null, hidden: true }
        : { pending: false, error: ack.error, hidden: false },
    );
  }

  function dispatchForm(event: FormEvent) {
    const next = reduceForm(formRef.current, event);
    formRef.current = next;
    setForm(next);
    // a refusal puts the inputs back on the last broadcast value
    if (next.status === "error") setRevision((r) => r + 1);
  }

  function onSetting(key: FormKey, raw: RawValue) {
    // LOBBY is the web action's (Postgres owns `Lobby.type`, ADR 0008); every other row is a room patch
    if (key === "lobbyType") {
      void submitLobbyType(
        {
          form: formRef.current,
          current: lobbyType,
          send: (type) => setLobbyType({ code, type }),
          dispatch: dispatchForm,
        },
        raw,
      );
      return;
    }
    const socket = socketRef.current;
    if (!socket || !state.settings) return;
    void submitSetting(
      {
        form: formRef.current,
        settings: state.settings,
        send: (patch) => socket.sendHostSettings(patch),
        dispatch: dispatchForm,
      },
      key,
      raw,
    );
  }

  return (
    <LobbyLiveView
      code={code}
      state={state}
      lobbyType={lobbyType}
      labels={labels}
      errors={errors}
      start={start}
      onStart={onStart}
      form={form}
      revision={revision}
      onSetting={onSetting}
      reset={reset}
    />
  );
}
