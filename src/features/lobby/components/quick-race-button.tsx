"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { createLobby } from "../actions/create-lobby";
import { InlineError } from "./inline-error";
import styles from "./lobby-entry.module.css";
import { errorMessage, type EntryError, type EntryErrors } from "./entry-errors";

export type QuickRaceLabels = { cta: string; searching: string };
export type QuickRaceState = { error: EntryError | null };

/**
 * Form action: QUICK RACE opens a public room and seats the player in it (matchmaking into an existing
 * open room is card 128); failures become an error line.
 */
export function makeQuickRaceAction(navigate: (href: string) => void) {
  return async function quickRace(): Promise<QuickRaceState> {
    try {
      const result = await createLobby({ settings: { lobbyType: "public" } });
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
  labels: QuickRaceLabels;
  errors: EntryErrors;
  /** `primary`: red stamp button on paper; `inverted`: paper button on the red band (bible 7.1). */
  variant?: "primary" | "inverted";
  action?: () => void;
};

export function QuickRaceButtonView({
  pending,
  error,
  labels,
  errors,
  variant = "primary",
  action,
}: ViewProps) {
  return (
    <form action={action} className={styles.entry}>
      <button
        type="submit"
        className={cn(styles.stamp, variant === "inverted" && styles.stampInverted)}
        disabled={pending}
        aria-busy={pending ? "true" : undefined}
      >
        {pending ? labels.searching : labels.cta}
      </button>
      {error ? (
        <InlineError prefix={errors.prefix}>{errorMessage(errors, error)}</InlineError>
      ) : null}
    </form>
  );
}

/** bible 7.1 primary stamp button, `QUICK RACE` -> `FINDING A ROOM…` while the room opens (bible 2). */
export function QuickRaceButton({
  labels,
  errors,
  variant,
}: {
  labels: QuickRaceLabels;
  errors: EntryErrors;
  variant?: "primary" | "inverted";
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(makeQuickRaceAction(router.push), {
    error: null,
  });
  return (
    <QuickRaceButtonView
      pending={pending}
      error={state.error}
      labels={labels}
      errors={errors}
      variant={variant}
      action={action}
    />
  );
}
