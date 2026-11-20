"use client";

import { useActionState, useId } from "react";
import { useRouter } from "next/navigation";
import { parseRoomCode } from "@fifth-copy/protocol/room-code";
import { joinByCode } from "../actions/join-by-code";
import { cn } from "@/lib/cn";
import { InlineError } from "./inline-error";
import styles from "./lobby-entry.module.css";
import { errorMessage, type EntryError, type EntryErrors } from "./entry-errors";
import type { Messages } from "@/i18n";

export type WatchLabels = Messages["landing"]["watch"];

/**
 * A spectator link's token (#999 C12): 43 base64url characters, the same shape as `INVITE_TOKEN_RE`
 * (`invite-token.ts`, which this light client door cannot import: zod and node:crypto). A unit test
 * keeps the two equal.
 */
export const WATCH_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Where a typed watch entry leads, or `null` when it is neither a room code nor a spectator link. */
export function readWatchEntry(raw: string): { link: string } | { code: string } | null {
  const text = raw.trim();
  // a pasted link (any host: the copy a host shared), or the bare token
  const path = /\/watch\/([^/?#\s]+)/.exec(text)?.[1] ?? text;
  if (WATCH_TOKEN_RE.test(path)) return { link: `/watch/${path}` };
  const code = parseRoomCode(text);
  return code ? { code } : null;
}

export type WatchState = { error: EntryError | "invalid-watch" | null };

/**
 * Form action: a spectator link goes straight to its `/watch/<token>` page; a room code is joined like
 * the code join (`joinByCode`) and opens the lobby, which a phone watches on a spectator token (#999 C9).
 * Anything else is rejected here, before any request.
 */
export function makeWatchAction(navigate: (href: string) => void) {
  return async function watch(_prev: WatchState, form: FormData): Promise<WatchState> {
    const raw = form.get("watch");
    const entry = typeof raw === "string" ? readWatchEntry(raw) : null;
    if (!entry) return { error: "invalid-watch" };
    if ("link" in entry) {
      navigate(entry.link);
      return { error: null };
    }
    try {
      const result = await joinByCode({ code: entry.code });
      if (!result.ok) return { error: result.error === "rate-limited" ? "generic" : result.error };
      navigate(`/lobby/${result.code}`);
      return { error: null };
    } catch {
      return { error: "generic" };
    }
  };
}

type ViewProps = {
  pending: boolean;
  error: WatchState["error"];
  labels: WatchLabels;
  errors: EntryErrors;
  ids: { input: string; error: string };
  action?: (form: FormData) => void;
};

/**
 * The phone landing's watch entry (#999 C15; bible 14.1, 14.3 "Phone spectator"): the 7.2 code group
 * (label, field, ink submit) taking a room code or a spectator link. Phones watch, so on a phone it
 * stands where QUICK RACE and the private-race entries stand on a desk.
 */
export function WatchEntryFormView({ pending, error, labels, errors, ids, action }: ViewProps) {
  return (
    <form action={action} aria-label={labels.formName} className={styles.entry} noValidate>
      <div className={styles.codeGroup}>
        <label htmlFor={ids.input} className={styles.codeLabel}>
          {labels.label}
        </label>
        <input
          id={ids.input}
          name="watch"
          className={cn(styles.codeInput, styles.watchInput)}
          placeholder={labels.placeholder}
          autoCapitalize="off"
          autoComplete="off"
          inputMode="url"
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
          {pending ? labels.pending : labels.submit}
        </button>
      </div>
      {error ? (
        <InlineError id={ids.error} prefix={errors.prefix}>
          {error === "invalid-watch" ? labels.invalid : errorMessage(errors, error)}
        </InlineError>
      ) : null}
    </form>
  );
}

export function WatchEntryForm({ labels, errors }: { labels: WatchLabels; errors: EntryErrors }) {
  const router = useRouter();
  const id = useId();
  const [state, action, pending] = useActionState(makeWatchAction(router.push), { error: null });
  return (
    <WatchEntryFormView
      pending={pending}
      error={state.error}
      labels={labels}
      errors={errors}
      ids={{ input: `${id}-watch`, error: `${id}-error` }}
      action={action}
    />
  );
}
