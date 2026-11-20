"use client";

import { useActionState, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRoomCode, parseRoomCode } from "@fifth-copy/protocol/room-code";
import { proveRoomCode } from "../actions/prove-room-code";
import type { EntryError, EntryErrors, EntryLabels } from "./entry-errors";
import { JoinByCodeFormView } from "./join-by-code-form";
import styles from "./invite.module.css";

export type RoomCodeGateLabels = {
  kicker: string;
  title: string;
  body: string;
  /** The code form's accessible name. */
  formName: string;
};

type GateState = { error: EntryError | null };

/**
 * The form action: a malformed code is refused here; `proveRoomCode` checks it against the page's room
 * and files the viewer's proof; `ok` refreshes the page, which then serves the code and opens the seat
 * or the projector (#999 C13). A throttled call or an unwritable proof is the generic line.
 */
export function makeGateAction(lobbyId: string, refresh: () => void) {
  return async function prove(_prev: GateState, form: FormData): Promise<GateState> {
    const raw = form.get("code");
    const code = typeof raw === "string" ? parseRoomCode(raw) : null;
    if (!code) return { error: "invalid-format" };
    try {
      const result = await proveRoomCode({ lobbyId, code });
      if (!result.ok) {
        const e = result.error;
        return { error: e === "rate-limited" || e === "unavailable" ? "generic" : e };
      }
      refresh();
      return { error: null };
    } catch {
      return { error: "generic" };
    }
  };
}

/**
 * The race page's code entry (#999 C13; bible 14.3 "Room code entry", an `/invite/[token]` refusal
 * screen's sibling): `/race/<id>` served no room code (the viewer is not the host and holds no proof:
 * a link holder, a shared URL, a new device), so the page asks for it before any seat or projector
 * opens. The file column: kicker, H1, one sentence, then the landing's code join group (7.2).
 */
export function RoomCodeGate({
  lobbyId,
  labels,
  entry,
  errors,
}: {
  lobbyId: string;
  labels: RoomCodeGateLabels;
  entry: EntryLabels;
  errors: EntryErrors;
}) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState("");
  const [state, action, pending] = useActionState(
    makeGateAction(lobbyId, () => router.refresh()),
    { error: null },
  );
  return (
    <section data-code-gate className={styles.screen} aria-labelledby={`${id}-title`}>
      <div className={styles.file}>
        <div className={styles.kicker}>{labels.kicker}</div>
        <h1 id={`${id}-title`} className={styles.title}>
          {labels.title}
        </h1>
        <p className={styles.body}>{labels.body}</p>
        <JoinByCodeFormView
          value={value}
          pending={pending}
          error={state.error}
          labels={{ ...entry, joinFormName: labels.formName }}
          errors={errors}
          ids={{ input: `${id}-code`, error: `${id}-error` }}
          onChange={(raw) => setValue(formatRoomCode(raw))}
          action={action}
        />
      </div>
    </section>
  );
}
