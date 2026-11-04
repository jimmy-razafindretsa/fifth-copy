"use client";

import { useActionState, useId, useState } from "react";
import { INITIAL_AUTH_STATE, type AuthFormState } from "../actions/auth-form-state";
import type { AuthField } from "../schema";
import styles from "./auth.module.css";

/** The strings one auth form shows (from the catalogs' `auth` namespace, ADR 0010). */
export type AuthFormLabels = {
  formName: string;
  username: string;
  password: string;
  usernameHint?: string;
  passwordHint?: string;
  submit: string;
  pending: string;
  errorPrefix: string;
};

export type AuthAction = (prev: AuthFormState, form: FormData) => Promise<AuthFormState>;

type ViewProps = {
  mode: "sign-in" | "sign-up";
  labels: AuthFormLabels;
  state: AuthFormState;
  pending: boolean;
  values: Record<AuthField, string>;
  callbackUrl?: string | null;
  onChange?: (field: AuthField, value: string) => void;
  action?: (form: FormData) => void;
};

function ErrorLine({ id, prefix, children }: { id?: string; prefix: string; children: string }) {
  return (
    <p id={id} role="alert" className={styles.errorLine}>
      <span className={styles.errorPrefix}>{prefix}</span> {children}
    </p>
  );
}

/**
 * The username form of `/sign-in` and `/sign-up` (#36, bible 7.2 inputs, 7.4 inline error lines, 7.1
 * stamp submit). Stateless, so `/design` renders each state (default, pending, invalid field, server
 * error) from props. A field error marks its input `aria-invalid` and is linked with `aria-describedby`
 * (after the hint); the server error is one `role="alert"` line above the submit. Pending reads the
 * pending label on a disabled, `aria-busy` submit, no spinner (printed, not glowing).
 */
export function AuthFormView({
  mode,
  labels,
  state,
  pending,
  values,
  callbackUrl,
  onChange,
  action,
}: ViewProps) {
  const id = useId();
  const field = (name: AuthField, label: string, hint: string | undefined) => {
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
          autoComplete={
            name === "username"
              ? "username"
              : mode === "sign-up"
                ? "new-password"
                : "current-password"
          }
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={name === "username" ? 64 : 256}
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
      aria-label={labels.formName}
      aria-busy={pending || undefined}
      className={styles.form}
      noValidate
    >
      {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
      {field("username", labels.username, labels.usernameHint)}
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
 * The live form: `action` is the server action (`signUpAction`, `signInAction`), so the markup never
 * changes when the actions do. The fields are controlled so a refused attempt keeps what was typed.
 */
export function AuthForm({
  action,
  ...rest
}: Omit<ViewProps, "state" | "pending" | "values" | "onChange" | "action"> & {
  action: AuthAction;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_AUTH_STATE);
  const [values, setValues] = useState<Record<AuthField, string>>({ username: "", password: "" });
  return (
    <AuthFormView
      {...rest}
      state={state}
      pending={pending}
      values={values}
      onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))}
      action={formAction}
    />
  );
}
