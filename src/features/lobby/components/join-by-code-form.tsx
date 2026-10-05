"use client";

import { useActionState, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRoomCode, parseRoomCode } from "@fifth-copy/protocol";
import { joinByCode } from "../actions/join-by-code";
import { InlineError } from "./inline-error";
import styles from "./lobby-entry.module.css";
import { errorMessage, type EntryError, type EntryErrors, type EntryLabels } from "./entry-errors";

export type JoinState = { error: EntryError | null };

/**
 * Form action: a malformed code is rejected here, before any request; the server's answer
 * (`not-found`, `closed`) becomes an error line and `ok` sends the player to the lobby.
 */
export function makeJoinAction(navigate: (href: string) => void) {
  return async function join(_prev: JoinState, form: FormData): Promise<JoinState> {
    const raw = form.get("code");
    const code = typeof raw === "string" ? parseRoomCode(raw) : null;
    if (!code) return { error: "invalid-format" };
    try {
      const result = await joinByCode({ code });
      if (!result.ok) return { error: result.error };
      navigate(`/lobby/${result.code}`);
      return { error: null };
    } catch {
      return { error: "generic" };
    }
  };
}

type ViewProps = {
  value: string;
  pending: boolean;
  error: EntryError | null;
  labels: EntryLabels;
  errors: EntryErrors;
  ids: { input: string; error: string };
  onChange?: (raw: string) => void;
  action?: (form: FormData) => void;
};

export function JoinByCodeFormView({
  value,
  pending,
  error,
  labels,
  errors,
  ids,
  onChange,
  action,
}: ViewProps) {
  return (
    <form action={action} aria-label={labels.joinFormName} className={styles.entry} noValidate>
      <div className={styles.codeGroup}>
        <label htmlFor={ids.input} className={styles.codeLabel}>
          {labels.joinWithCode}
        </label>
        <input
          id={ids.input}
          name="code"
          className={styles.codeInput}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder={labels.codePlaceholder}
          maxLength={8}
          autoCapitalize="characters"
          autoComplete="off"
          inputMode="text"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? ids.error : undefined}
        />
        <button
          type="submit"
          className={styles.inkButton}
          disabled={pending}
          aria-busy={pending ? "true" : undefined}
        >
          {pending ? labels.joining : labels.join}
        </button>
      </div>
      {error ? (
        <InlineError id={ids.error} prefix={errors.prefix}>
          {errorMessage(errors, error)}
        </InlineError>
      ) : null}
    </form>
  );
}

/** bible 7.2 code join group `[ JOIN WITH CODE | KGB-4821 | JOIN → ]`, masked as the player types. */
export function JoinByCodeForm({ labels, errors }: { labels: EntryLabels; errors: EntryErrors }) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState("");
  const [state, action, pending] = useActionState(makeJoinAction(router.push), { error: null });
  return (
    <JoinByCodeFormView
      value={value}
      pending={pending}
      error={state.error}
      labels={labels}
      errors={errors}
      ids={{ input: `${id}-code`, error: `${id}-error` }}
      onChange={(raw) => setValue(formatRoomCode(raw))}
      action={action}
    />
  );
}
