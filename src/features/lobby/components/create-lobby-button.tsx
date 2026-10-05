"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { createLobby } from "../actions/create-lobby";
import { InlineError } from "./inline-error";
import styles from "./lobby-entry.module.css";
import { errorMessage, type EntryError, type EntryErrors, type EntryLabels } from "./entry-errors";

export type CreateState = { error: EntryError | null };

/** Form action: creates the lobby and sends the host to it; failures become an error line. */
export function makeCreateAction(navigate: (href: string) => void) {
  return async function create(): Promise<CreateState> {
    try {
      const result = await createLobby();
      if (!result.ok) return { error: result.error };
      navigate(`/lobby/${result.code}`);
      return { error: null };
    } catch {
      return { error: "generic" };
    }
  };
}

type ViewProps = {
  pending: boolean;
  error: EntryError | null;
  labels: EntryLabels;
  errors: EntryErrors;
  action?: () => void;
};

export function CreateLobbyButtonView({ pending, error, labels, errors, action }: ViewProps) {
  return (
    <form action={action} className={styles.entry}>
      <button
        type="submit"
        className={styles.secondary}
        disabled={pending}
        aria-busy={pending ? "true" : undefined}
      >
        {pending ? labels.creating : labels.createPrivateRace}
      </button>
      {error ? (
        <InlineError prefix={errors.prefix}>{errorMessage(errors, error)}</InlineError>
      ) : null}
    </form>
  );
}

/** bible 7.1 secondary button (reference `Fifth Copy Landing.dc.html`): creates a private lobby. */
export function CreateLobbyButton({
  labels,
  errors,
}: {
  labels: EntryLabels;
  errors: EntryErrors;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(makeCreateAction(router.push), { error: null });
  return (
    <CreateLobbyButtonView
      pending={pending}
      error={state.error}
      labels={labels}
      errors={errors}
      action={action}
    />
  );
}
