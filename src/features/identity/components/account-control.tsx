import { fill } from "@/i18n/format";
import type { Viewer } from "@/server/auth";
import { signOut } from "../actions/sign-out";

export type AccountLabels = {
  honorific: string;
  guestTag: string;
  signIn: string;
  signOut: string;
};

/** The header's own classes, so the control joins its flex rows (bible 14.1 phone rule). */
export type AccountClasses = {
  docket: string | undefined;
  docketName: string | undefined;
  tag: string | undefined;
  signIn: string | undefined;
};

export const SIGN_IN_HREF = "/sign-in";

/**
 * The header account control (#36 C12, bible 14.1 item 1): signed out, `SIGN IN`; a guest, the docket
 * (name + `GUEST` tag) and `SIGN IN`; an account, the docket (name) and `SIGN OUT`, a form posting the
 * `signOut` action (works before hydration). Renders its items bare (no wrapper) so the header lays
 * them out; reused by the lobby and settings headers.
 */
export function AccountControl({
  viewer,
  labels,
  classes,
}: {
  viewer: Viewer | null;
  labels: AccountLabels;
  classes: AccountClasses;
}) {
  return (
    <>
      {viewer ? (
        <div className={classes.docket}>
          <span className={classes.docketName}>
            {fill(labels.honorific, { name: viewer.name })}
          </span>
          {viewer.isGuest ? <span className={classes.tag}>{labels.guestTag}</span> : null}
        </div>
      ) : null}
      {viewer && !viewer.isGuest ? (
        <form action={signOut} className="contents">
          <button type="submit" className={classes.signIn}>
            {labels.signOut}
          </button>
        </form>
      ) : (
        <a href={SIGN_IN_HREF} className={classes.signIn}>
          {labels.signIn}
        </a>
      )}
    </>
  );
}
