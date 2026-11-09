"use client";

import { useActionState, useId, useState, useSyncExternalStore } from "react";
import { Alert } from "@/components/ui";
import { INITIAL_RECOVER_STATE, type RecoverFormState } from "../actions/recover-form-state";
import type { ResetField } from "../schema";
import styles from "./auth.module.css";
import { RecoveryCard, type RecoveryCardLabels } from "./recovery-card";

/** The strings of the `/recover` form (the catalogs' `auth.recovery` namespace, ADR 0010, #46). */
export type RecoverFormLabels = {
  formName: string;
  username: string;
  code: string;
  codeHint: string;
  password: string;
  passwordHint: string;
  submit: string;
  pending: string;
  errorPrefix: string;
  doneTitle: string;
  doneBody: string;
  signInHref: string;
  card: RecoveryCardLabels;
};

export type RecoverAction = (prev: RecoverFormState, form: FormData) => Promise<RecoverFormState>;

type ViewProps = {
  labels: RecoverFormLabels;
  state: RecoverFormState;
  pending: boolean;
  values: Record<ResetField, string>;
  onChange?: (field: ResetField, value: string) => void;
  action?: (form: FormData) => void;
  hydrated?: boolean;
};

const EMPTY: Record<ResetField, string> = { username: "", code: "", password: "" };
const noSubscribe = () => () => {};

function ErrorLine({ id, prefix, children }: { id?: string; prefix: string; children: string }) {
  return (
    <p id={id} role="alert" className={styles.errorLine}>
      <span className={styles.errorPrefix}>{prefix}</span> {children}
    </p>
  );
}

/**
 * The `/recover` form (#46 C3, bible 14.3 "Recovery code"): the `/reset` form of #789 with the recovery
 * code field (10 words, any order, case or accents). Stateless, so `/design` renders every state from
 * props. Success replaces the form with the 7.4 success alert row and the recovery card holding the
 * NEW code, shown once; its continue links to `/sign-in`. Messages never echo what was typed.
 */
export function RecoverFormView({
  labels,
  state,
  pending,
  values,
  onChange,
  action,
  hydrated,
}: ViewProps) {
  const id = useId();
  if (state.status === "done") {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" title={labels.doneTitle}>
          <p>{labels.doneBody}</p>
        </Alert>
        {state.words ? (
          <RecoveryCard
            words={state.words}
            labels={labels.card}
            href={labels.signInHref}
            inset={false}
          />
        ) : null}
      </div>
    );
  }
  const field = (name: ResetField, label: string, hint?: string) => {
    const inputId = `${id}-${name}`;
    const hintId = hint ? `${inputId}-hint` : null;
    const error = state.fieldErrors[name];
    const errorId = error ? `${inputId}-error` : null;
    const valueProps = onChange
      ? {
          value: values[name],
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(name, e.target.value),
        }
      : { defaultValue: values[name] };
    return (
      <div className={styles.field}>
        <label htmlFor={inputId} className={styles.label}>
          {label}
        </label>
        <input
          id={inputId}
          name={name}
          className={styles.input}
          type={name === "password" ? "password" : "text"}
          autoComplete={name === "username" ? "username" : name === "code" ? "off" : "new-password"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={name === "username" ? 64 : name === "code" ? 400 : 256}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          {...valueProps}
        />
        {hint ? (
          <p id={hintId!} className={styles.hint}>
            {hint}
          </p>
        ) : null}
        {error ? (
          <ErrorLine id={errorId!} prefix={labels.errorPrefix}>
            {error}
          </ErrorLine>
        ) : null}
      </div>
    );
  };
  return (
    <form
      action={action}
      // a server action sets POST itself (React warns on an explicit method); a specimen still POSTs
      method={action ? undefined : "post"}
      aria-label={labels.formName}
      aria-busy={pending || undefined}
      data-hydrated={hydrated || undefined}
      className={styles.form}
      noValidate
    >
      {field("username", labels.username)}
      {field("code", labels.code, labels.codeHint)}
      {field("password", labels.password, labels.passwordHint)}
      {state.formError ? (
        <ErrorLine prefix={labels.errorPrefix}>{state.formError}</ErrorLine>
      ) : null}
      <button
        type="submit"
        className={styles.submit}
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {pending ? labels.pending : labels.submit}
      </button>
    </form>
  );
}

/**
 * The live form: `action` is `redeemRecoveryCodeAction`, a server action, so the form POSTs (never a
 * GET with the code in the URL) before and after hydration. The values live in component state only
 * (no URL, cookie or storage) and are kept after a refusal.
 */
export function RecoverForm({
  action,
  labels,
}: {
  action: RecoverAction;
  labels: RecoverFormLabels;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_RECOVER_STATE);
  const hydrated = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  const [values, setValues] = useState(EMPTY);
  return (
    <RecoverFormView
      labels={labels}
      state={state}
      pending={pending}
      values={values}
      onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))}
      action={formAction}
      hydrated={hydrated}
    />
  );
}
