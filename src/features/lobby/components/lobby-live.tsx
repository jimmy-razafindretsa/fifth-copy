"use client";

import { useEffect, useReducer } from "react";
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
import styles from "./lobby.module.css";

type ViewProps = { code: string; state: LobbyState; labels: LobbyLabels; errors: EntryErrors };

/** The room docket and the roll for one lobby state (no hooks, so every state renders in tests). */
export function LobbyLiveView({ code, state, labels, errors }: ViewProps) {
  const known = state.phase === "live" || state.phase === "reconnecting";
  return (
    <div className={styles.room}>
      <RoomCodeDocket
        code={code}
        count={known ? state.members.length : null}
        seats={ROOM_SEATS}
        labels={labels}
      />
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
    </div>
  );
}

/**
 * The waiting room's client leaf (ARCHITECTURE 8.3): mints the race token through the action (ADR
 * 0009: never in a URL, the HTML or a cookie), connects through a lazily loaded `connectToRoom` (ADR 0006, 0013) and keeps
 * the roster in one store that later cards extend with more events.
 */
export function LobbyLive({
  code,
  labels,
  errors,
}: {
  code: string;
  labels: LobbyLabels;
  errors: EntryErrors;
}) {
  const [state, dispatch] = useReducer(reduceLobby, initialLobbyState);

  useEffect(() => {
    // StrictMode runs this twice in dev: a stale mint must never open a socket.
    let aborted = false;
    let socket: RoomSocket | null = null;
    // The socket module (socket.io-client + protocol schemas) is a lazy chunk (ADR 0013 budget):
    // its download overlaps the mint round trip, and a failed chunk load is a generic error.
    Promise.all([mintRaceToken({ code }), import("@/features/race")]).then(
      ([result, { connectToRoom }]) => {
        if (aborted) return;
        if (!result.ok) return dispatch({ type: "token-error", error: result.error });
        socket = connectToRoom(result.url, result.token);
        bindRoomSocket(socket, dispatch);
      },
      () => {
        if (!aborted) dispatch({ type: "token-error", error: "generic" });
      },
    );
    return () => {
      aborted = true;
      socket?.close();
    };
  }, [code]);

  return <LobbyLiveView code={code} state={state} labels={labels} errors={errors} />;
}
