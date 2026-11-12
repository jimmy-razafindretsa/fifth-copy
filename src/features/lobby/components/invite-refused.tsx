"use client";

import { Stamp } from "@/components/ui";
import type { Messages } from "@/i18n";
import type { InviteOutcome } from "../types";
import { errorMessage, type EntryErrors, type EntryLabels } from "./entry-errors";
import { InlineError } from "./inline-error";
import { JoinByCodeForm } from "./join-by-code-form";
import styles from "./invite.module.css";

export type InviteLabels = Messages["invite"];

/** Where the refusal's secondary link goes: the landing. */
export const INVITE_HOME = "/";

/** The inline error line's sentence for an outcome that is not the stamp (`landing.errors`). */
function errorFor(errors: EntryErrors, outcome: Exclude<InviteOutcome, "invite" | "refused">) {
  return errorMessage(
    errors,
    outcome === "closed"
      ? "closed"
      : outcome === "unavailable"
        ? "race-server-unavailable"
        : "generic",
  );
}

/**
 * The refusal screen of `/invite/[token]` (#809, bible 14.3): a link not on file (used, expired, never
 * issued, or lost to another press) is the ink `Stamp` at `md`, `REFUSED` / `LINK USED OR EXPIRED`,
 * slamming in (none under reduced motion); `closed`, `rate-limited` and `unavailable` show the 7.4
 * inline error line with the landing's sentence instead. Then one sentence, the landing's code join
 * group and the secondary link to `/`. `announce`: the refusal follows a press, so the stamp is a
 * status; on a page load it is static paperwork.
 */
export function InviteRefused({
  outcome,
  labels,
  errors,
  entry,
  announce = false,
}: {
  outcome: Exclude<InviteOutcome, "invite">;
  labels: InviteLabels;
  errors: EntryErrors;
  entry: EntryLabels;
  announce?: boolean;
}) {
  const r = labels.refused;
  return (
    <section className={styles.screen} aria-labelledby="invite-title">
      <div className={styles.file}>
        <div className={styles.kicker}>{labels.kicker}</div>
        <h1 id="invite-title" className={styles.srOnly}>
          {`${r.stamp} · ${r.stamp2}`}
        </h1>
        {outcome === "refused" ? (
          <Stamp
            lines={[r.stamp, r.stamp2]}
            tone="ink"
            size="md"
            rotation={-6}
            role={announce ? "status" : null}
            className={styles.stamp}
          />
        ) : (
          <div className={styles.join}>
            <InlineError prefix={errors.prefix}>{errorFor(errors, outcome)}</InlineError>
          </div>
        )}
        <p className={styles.body}>{r.body}</p>
        <div className={styles.join}>
          <JoinByCodeForm labels={entry} errors={errors} />
        </div>
        <a href={INVITE_HOME} className={styles.secondary}>
          {r.home}
        </a>
      </div>
    </section>
  );
}
