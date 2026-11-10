"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createInvite } from "../actions/create-invite";
import type { CreateInviteResult } from "../types";
import { errorMessage, type EntryErrors } from "./entry-errors";
import { InlineError } from "./inline-error";
import { copiedHoldMs, copyRoomCode, type CopyStatus } from "./invite-docket";
import type { LobbyLabels } from "./lobby-labels";
import styles from "./lobby.module.css";

type LinkLabels = LobbyLabels["links"];
type LinkError = Extract<CreateInviteResult, { ok: false }>["error"];

export type LinkRowState = {
  pending: boolean;
  url: string | null;
  copy: CopyStatus;
  error: LinkError | null;
};

export const IDLE_LINK: LinkRowState = { pending: false, url: null, copy: "idle", error: null };

/** The 7.4 inline error line's sentence for a refused link (`landing.errors`, one of the row's own). */
export function linkErrorCopy(labels: LinkLabels, errors: EntryErrors, error: LinkError): string {
  switch (error) {
    case "not-host":
      return labels.notHost;
    case "closed":
      return errorMessage(errors, "closed");
    case "not-found":
      return errorMessage(errors, "not-found");
    case "unavailable":
      return errorMessage(errors, "race-server-unavailable");
    default:
      return errorMessage(errors, "generic");
  }
}

/**
 * The host's link row (#809, bible 14.3), no hooks: `LINK` | the 7.1 ink button `NEW LINK` (`ISSUING…`,
 * `aria-busy`, on its way), then the issued URL (IBM Plex Mono, one line, ellipsis, selectable, `title`
 * = the URL) with its own ink `COPY` (the room code's recipe), a polite status, and a refusal as the
 * 7.4 inline error line under the row. Carries `.invite`, so phones (480px and under) never show it.
 */
export function InviteLinkRowView({
  state,
  labels,
  errors,
  urlId,
  errorId,
  onIssue,
  onCopy,
  onBlur,
}: {
  state: LinkRowState;
  labels: LinkLabels;
  errors: EntryErrors;
  urlId: string;
  errorId: string;
  onIssue?: () => void;
  onCopy?: () => void;
  onBlur?: () => void;
}) {
  return (
    <div className={`${styles.row} ${styles.invite}`}>
      <dt className={styles.label}>{labels.label}</dt>
      <dd className={`${styles.value} ${styles.links}`}>
        <button
          type="button"
          className={styles.ink}
          onClick={onIssue}
          disabled={state.pending}
          aria-busy={state.pending ? "true" : undefined}
          aria-describedby={state.error ? errorId : undefined}
        >
          {state.pending ? labels.issuing : labels.newLink}
        </button>
        {state.url ? (
          <span className={styles.linkLine}>
            <span
              id={urlId}
              className={styles.url}
              title={state.url}
              role="group"
              aria-label={labels.urlName}
            >
              {state.url}
            </span>
            <button type="button" className={styles.ink} onClick={onCopy} onBlur={onBlur}>
              {state.copy === "copied" ? labels.copied : labels.copy}
            </button>
          </span>
        ) : null}
        <span role="status" className={styles.srOnly}>
          {state.copy === "copied"
            ? labels.copiedStatus
            : state.copy === "selected"
              ? labels.selectedStatus
              : ""}
        </span>
        {state.error ? (
          <InlineError id={errorId} prefix={errors.prefix}>
            {linkErrorCopy(labels, errors, state.error)}
          </InlineError>
        ) : null}
      </dd>
    </div>
  );
}

const HOLD_TOKEN = "--motion-duration-slow";

/**
 * The host's link row with its behaviour: each `NEW LINK` press calls `createInvite` (the action checks
 * the host; older links stay valid until used or expired) and replaces the shown URL; `COPY` follows the
 * room code's COPY (COPIED for `--motion-duration-slow` x 3, until blur under reduced motion; without a
 * clipboard it selects the URL).
 */
export function InviteLinkRow({
  code,
  labels,
  errors,
}: {
  code: string;
  labels: LinkLabels;
  errors: EntryErrors;
}) {
  const id = useId();
  const urlId = `${id}-url`;
  const [state, setState] = useState<LinkRowState>(IDLE_LINK);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stopTimer, []);

  async function onIssue() {
    if (state.pending) return;
    stopTimer();
    setState((s) => ({ ...s, pending: true, error: null }));
    let result: CreateInviteResult;
    try {
      result = await createInvite({ code });
    } catch {
      result = { ok: false, error: "unavailable" };
    }
    setState((s) =>
      result.ok
        ? { pending: false, url: result.url, copy: "idle", error: null }
        : { ...s, pending: false, error: result.error },
    );
  }

  async function onCopy() {
    const url = state.url;
    if (!url) return;
    stopTimer();
    const copy = await copyRoomCode(url, {
      clipboard: navigator.clipboard,
      select: () => {
        const node = document.getElementById(urlId);
        const selection = window.getSelection();
        if (node && selection) selection.selectAllChildren(node);
      },
    });
    setState((s) => ({ ...s, copy }));
    if (copy !== "copied") return;
    const hold = copiedHoldMs(
      getComputedStyle(document.documentElement).getPropertyValue(HOLD_TOKEN),
    );
    if (hold === 0) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setState((s) => ({ ...s, copy: "idle" }));
    }, hold);
  }

  function onBlur() {
    if (!timer.current) setState((s) => (s.copy === "copied" ? { ...s, copy: "idle" } : s));
  }

  return (
    <InviteLinkRowView
      state={state}
      labels={labels}
      errors={errors}
      urlId={urlId}
      errorId={`${id}-error`}
      onIssue={onIssue}
      onCopy={onCopy}
      onBlur={onBlur}
    />
  );
}
