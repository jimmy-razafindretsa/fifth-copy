"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import type { Messages } from "@/i18n";
import { createPracticeLobby } from "../actions/create-practice-lobby";
import { InlineError } from "./inline-error";
import styles from "./lobby-entry.module.css";
import { errorMessage, type EntryError, type EntryErrors } from "./entry-errors";

export type PracticeLabels = Messages["landing"]["entries"];
type PracticeState = { error: EntryError | null };

/** Form action: opens a private race seated with bots and sends its host there; failures become an error line. */
export function makePracticeAction(navigate: (href: string) => void) {
  return async function practise(): Promise<PracticeState> {
    try {
      const result = await createPracticeLobby();
      // invalid-settings cannot come from this fixed call: no catalog line of its own.
      if (!result.ok)
        return { error: result.error === "invalid-settings" ? "generic" : result.error };
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
  labels: PracticeLabels;
  errors: EntryErrors;
  action?: () => void;
};

export function PracticeButtonView({ pending, error, labels, errors, action }: ViewProps) {
  return (
    <form action={action} className={styles.entry}>
      <button
        type="submit"
        className={styles.secondary}
        disabled={pending}
        aria-busy={pending ? "true" : undefined}
      >
        {pending ? labels.practising : labels.practise}
      </button>
      {error ? (
        <InlineError prefix={errors.prefix}>{errorMessage(errors, error)}</InlineError>
      ) : null}
    </form>
  );
}

/** bible 7.1 secondary button, under CREATE PRIVATE RACE (14.1): solo practice against bots (#367). */
export function PracticeButton({
  labels,
  errors,
}: {
  labels: PracticeLabels;
  errors: EntryErrors;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(makePracticeAction(router.push), {
    error: null,
  });
  return (
    <PracticeButtonView
      pending={pending}
      error={state.error}
      labels={labels}
      errors={errors}
      action={action}
    />
  );
}
