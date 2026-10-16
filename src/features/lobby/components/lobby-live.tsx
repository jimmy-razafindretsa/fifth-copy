"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RoomSocket } from "@/features/race";
import { mintRaceToken } from "../actions/mint-race-token";
import { errorMessage, type EntryErrors } from "./entry-errors";
import { InlineError } from "./inline-error";
import { playersLabel, type LobbyLabels } from "./lobby-labels";
import {
  bindRoomSocket,
  initialLobbyState,
  reduceLobby,
  ROOM_SEATS,
  type LobbyState,
} from "./lobby-store";
import { PlayerList, PlayerListSkeleton } from "./player-list";
import { RoomCodeDocket } from "./room-code-docket";
import { StartControl, type StartError } from "./start-control";
import styles from "./lobby.module.css";

/** The host's START between the click and the countdown (#214 C8); `hidden` after a `not-host` ack. */
export type StartState = { pending: boolean; error: StartError | null; hidden: boolean };

const IDLE_START: StartState = { pending: false, error: null, hidden: false };

type ViewProps = {
  code: string;
  state: LobbyState;
  labels: LobbyLabels;
  errors: EntryErrors;
  start?: StartState;
  onStart?: () => void;
};

/** The viewer's own row says whether they host (`Member.isHost`, protocol v4). */
const isHost = (state: LobbyState) => state.members.some((m) => m.desk === state.you && m.isHost);

/** The room docket, the roll and the host's START for one lobby state (no hooks, so every state renders in tests). */
export function LobbyLiveView({
  code,
  state,
  labels,
  errors,
  start = IDLE_START,
  onStart,
}: ViewProps) {
  const known =
    state.phase === "live" || state.phase === "reconnecting" || state.phase === "starting";
  const canStart = (state.phase === "live" || state.phase === "starting") && isHost(state);
  return (
    <div className={styles.room}>
      <RoomCodeDocket
        code={code}
        count={known ? state.members.length : null}
        seats={ROOM_SEATS}
        labels={labels}
      />
      <div className={styles.side}>
        <div className={styles.roll}>
          {state.phase === "reconnecting" ? (
            <p role="status" className={styles.notice}>
              {labels.reconnecting}
            </p>
          ) : null}
          {state.phase === "loading" ? <PlayerListSkeleton labels={labels} /> : null}
          {known ? <PlayerList members={state.members} you={state.you} labels={labels} /> : null}
          {state.phase === "error" ? (
            <div className={styles.error}>
              <InlineError prefix={errors.prefix}>
                {errorMessage(errors, state.error ?? "generic")}
              </InlineError>
            </div>
          ) : null}
          <p aria-live="polite" className={styles.srOnly}>
            {known ? playersLabel(labels, state.members.length) : ""}
          </p>
        </div>
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
    </div>
  );
}

/**
 * The waiting room's client leaf (ARCHITECTURE 8.3): mints the race token through the action (ADR
 * 0009: never in a URL, the HTML or a cookie), connects through a lazily loaded `connectToRoom` (ADR
 * 0006, 0013) and keeps the roster in one store that later cards extend with more events. Every welcome
 * stores the desk's resume key for the seat view. The host's START sends `host:start`; the `countdown`
 * that follows moves every member to `/race/<raceId>` once (#214), and the socket is parked for the seat
 * view instead of closed, so the desk is never line-cut while that page connects.
 */
export function LobbyLive({
  code,
  lobbyId,
  labels,
  errors,
}: {
  code: string;
  /** The room's lobby id (`Lobby.id`): the resume key and the parked socket are keyed by it. */
  lobbyId: string;
  labels: LobbyLabels;
  errors: EntryErrors;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reduceLobby, initialLobbyState);
  const [start, setStart] = useState<StartState>(IDLE_START);
  const socketRef = useRef<RoomSocket | null>(null);
  // set once the page moves to the seat view: the cleanup then parks the socket instead of closing it
  const handedOver = useRef(false);

  useEffect(() => {
    // StrictMode runs this twice in dev: a stale mint must never open a socket.
    let aborted = false;
    let socket: RoomSocket | null = null;
    let unbind = () => {};
    let park: ((lobbyId: string, socket: RoomSocket) => void) | null = null;
    // The socket module (socket.io-client + protocol schemas) is a lazy chunk (ADR 0013 budget):
    // its download overlaps the mint round trip, and a failed chunk load is a generic error.
    Promise.all([mintRaceToken({ code }), import("@/features/race")]).then(
      ([result, race]) => {
        if (aborted) return;
        if (!result.ok) return dispatch({ type: "token-error", error: result.error });
        socket = race.connectToRoom(result.url, result.token);
        socketRef.current = socket;
        park = race.parkSocket;
        unbind = bindRoomSocket(socket, dispatch, {
          lobbyId,
          storeResumeKey: race.storeResumeKey,
        });
      },
      () => {
        if (!aborted) dispatch({ type: "token-error", error: "generic" });
      },
    );
    return () => {
      aborted = true;
      unbind();
      socketRef.current = null;
      if (socket && handedOver.current && park) park(lobbyId, socket);
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

  return (
    <LobbyLiveView
      code={code}
      state={state}
      labels={labels}
      errors={errors}
      start={start}
      onStart={onStart}
    />
  );
}
