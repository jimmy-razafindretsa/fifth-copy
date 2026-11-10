"use client";

import { useActionState } from "react";
import { takeInvite, type TakeInviteState } from "../actions/take-invite";
import type { InviteOutcome } from "../types";
import type { EntryErrors, EntryLabels } from "./entry-errors";
import { InviteRefused, type InviteLabels } from "./invite-refused";
import styles from "./invite.module.css";

type Strings = { labels: InviteLabels; errors: EntryErrors; entry: EntryLabels };

/**
 * The invitation (#809, bible 14.3): kicker, H1 `YOU ARE EXPECTED`, one 7.4 docket `FORM | INVITE`,
 * `SEATS | ONE` (no room code: the link is the only key), then the primary stamp button
 * `TAKE YOUR DESK` in a form that posts the token (ADR 0009: the press consumes, the GET only peeks).
 */
export function InvitationView({
  token,
  labels,
  pending = false,
  action,
}: {
  token: string;
  labels: InviteLabels;
  pending?: boolean;
  action?: (form: FormData) => void;
}) {
  return (
    <section className={styles.screen} aria-labelledby="invite-title">
      <div className={styles.file}>
        <div className={styles.kicker}>{labels.kicker}</div>
        <h1 id="invite-title" className={styles.title}>
          {labels.title}
        </h1>
        <dl className={styles.docket}>
          {labels.rows.map(([label, value]) => (
            <div key={label} className={styles.row}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <form action={action} className={styles.take}>
          <input type="hidden" name="token" value={token} />
          <button
            type="submit"
            className={styles.primary}
            disabled={pending}
            aria-busy={pending ? "true" : undefined}
          >
            {labels.take}
          </button>
        </form>
      </div>
    </section>
  );
}

/** One screen per outcome, no hooks (every state renders in tests). */
export function InviteScreenView({
  outcome,
  token,
  pending,
  action,
  announce,
  ...strings
}: Strings & {
  outcome: InviteOutcome;
  token: string;
  pending?: boolean;
  action?: (form: FormData) => void;
  announce?: boolean;
}) {
  if (outcome === "invite") {
    return (
      <InvitationView token={token} labels={strings.labels} pending={pending} action={action} />
    );
  }
  return <InviteRefused outcome={outcome} announce={announce} {...strings} />;
}

/**
 * The client leaf of `/invite/[token]`: starts on the server's peek (`initial`) and swaps to the
 * refusal when the press is refused; a successful press is a server redirect to `/lobby/<code>`.
 */
export function InviteFlow({
  token,
  initial,
  ...strings
}: Strings & { token: string; initial: InviteOutcome }) {
  const [state, action, pending] = useActionState<TakeInviteState, FormData>(takeInvite, {
    outcome: null,
  });
  return (
    <InviteScreenView
      outcome={state.outcome ?? initial}
      token={token}
      pending={pending}
      action={action}
      announce={state.outcome !== null}
      {...strings}
    />
  );
}
