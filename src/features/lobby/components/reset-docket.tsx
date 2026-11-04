"use client";

import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui";
import type { IssuePasswordResetResult } from "@/features/identity";
import { InlineError } from "./inline-error";
import { fill, type LobbyLabels } from "./lobby-labels";
import styles from "./lobby.module.css";

export type ResetLabels = LobbyLabels["reset"];
export type ResetError = keyof ResetLabels["errors"];

/** The server action (`issuePasswordReset`, #788), passed in so a later live-roll control reuses the docket. */
export type IssueReset = (input: {
  code: string;
  username: string;
}) => Promise<IssuePasswordResetResult>;

/**
 * The docket's state, in component state only: the issued code is never written to the URL, a
 * cookie or storage, so a reload shows the default docket again (#790 C3).
 */
export type ResetState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "issued"; code: string }
  | { status: "error"; error: ResetError; retryAfterMs?: number };

export const IDLE_RESET: ResetState = { status: "idle" };

/** One issuance: pending, then the code or the refusal; a thrown call (network, server) is `generic`. */
export async function submitReset(
  issue: IssueReset,
  input: { code: string; username: string },
  set: (state: ResetState) => void,
): Promise<ResetState> {
  set({ status: "pending" });
  let next: ResetState;
  try {
    const result = await issue(input);
    if (result.ok) next = { status: "issued", code: result.code };
    else if (result.error === "rate-limited")
      next = { status: "error", error: "rate-limited", retryAfterMs: result.retryAfterMs };
    else next = { status: "error", error: result.error };
  } catch {
    next = { status: "error", error: "generic" };
  }
  set(next);
  return next;
}

/** The refusal's sentence from the catalog; the wait is whole minutes, at least 1. */
export function resetErrorText(labels: ResetLabels, state: ResetState & { status: "error" }) {
  if (state.error !== "rate-limited") return labels.errors[state.error];
  const m = Math.max(1, Math.ceil((state.retryAfterMs ?? 0) / 60_000));
  return fill(labels.errors["rate-limited"], { m });
}

type ViewProps = {
  state: ResetState;
  labels: ResetLabels;
  /** The 7.4 inline error line's rejection word (`RETURNED ·`). */
  prefix: string;
  /** The code's lifetime in minutes (`RESET_CODE_TTL_MS`, #788), printed on the issued row. */
  ttlMinutes: number;
  /** Stable ids (from `useId` in the client leaf). */
  ids?: { input: string; error: string };
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
};

/**
 * The host's `FORM 5-R · PASSWORD RESET` docket (#790; bible 14.3 lobby layout, 7.4, 7.1, 7.2, 4):
 * the newsprint docket under the settings docket, one `STUDENT | <input>` row (the row label names the
 * input), the 7.1 secondary `ISSUE A CODE`. Issued: a 7.4 success alert row with the code in IBM Plex
 * Mono, its expiry and the hand-over line. Refused: the 7.4 inline error line under the row, linked to
 * the input, never echoing what was typed. No hooks, so every state renders in tests.
 */
export function ResetDocketView({
  state,
  labels,
  prefix,
  ttlMinutes,
  ids = { input: "lobby-reset-student", error: "lobby-reset-error" },
  onSubmit,
}: ViewProps) {
  const pending = state.status === "pending";
  const error = state.status === "error" ? state : null;
  return (
    <section aria-label={labels.tag} className={`${styles.docket} ${styles.reset}`}>
      <div className={styles.docketHead}>
        <span className={styles.code}>{labels.name}</span>
        <span className={styles.tag}>{labels.tag}</span>
      </div>
      <form onSubmit={onSubmit} noValidate>
        <div className={styles.row}>
          <label htmlFor={ids.input} className={styles.label}>
            {labels.student}
          </label>
          <input
            id={ids.input}
            name="username"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={256}
            className={styles.field}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? ids.error : undefined}
          />
        </div>
        {error ? (
          <div className={styles.error}>
            <InlineError id={ids.error} prefix={prefix}>
              {resetErrorText(labels, error)}
            </InlineError>
          </div>
        ) : null}
        <div className={styles.resetActions}>
          <button
            type="submit"
            className={styles.resetButton}
            disabled={pending}
            aria-busy={pending || undefined}
          >
            {pending ? labels.pending : labels.issue}
          </button>
        </div>
      </form>
      {state.status === "issued" ? (
        <div className={styles.resetIssued}>
          <Alert tone="success" title={labels.issued}>
            <span data-reset-code className={styles.resetCode}>
              {state.code}
            </span>
            <span className={styles.resetNote}>{fill(labels.expires, { m: ttlMinutes })}</span>
            <span className={styles.resetNote}>{labels.handOver}</span>
          </Alert>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The client leaf: local state only. The server component renders it for the lobby's teacher host
 * alone (#790 C1); `issue` re-checks everything on the server (ADR 0009). The input clears once a code
 * is issued, so the name and the code never sit side by side.
 */
export function ResetDocket({
  code,
  issue,
  labels,
  prefix,
  ttlMinutes,
}: {
  code: string;
  issue: IssueReset;
  labels: ResetLabels;
  prefix: string;
  ttlMinutes: number;
}) {
  const [state, setState] = useState<ResetState>(IDLE_RESET);
  const id = useId();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status === "pending") return;
    const form = event.currentTarget;
    const username = String(new FormData(form).get("username") ?? "");
    const next = await submitReset(issue, { code, username }, setState);
    if (next.status === "issued") form.reset();
  }

  return (
    <ResetDocketView
      state={state}
      labels={labels}
      prefix={prefix}
      ttlMinutes={ttlMinutes}
      ids={{ input: `${id}-student`, error: `${id}-error` }}
      onSubmit={onSubmit}
    />
  );
}
