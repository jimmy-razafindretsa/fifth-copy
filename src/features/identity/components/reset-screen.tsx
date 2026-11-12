import { getT } from "@/i18n";
import { redeemPasswordResetAction } from "../actions/redeem-password-reset";
import { AUTH_LINKS } from "./auth-screen";
import styles from "./auth.module.css";
import { ResetForm, type ResetFormLabels } from "./reset-form";

type Messages = Awaited<ReturnType<typeof getT>>;

/** The `/reset` form labels, all from `auth.reset` (#789 C6). */
export function resetFormLabels(t: Messages): ResetFormLabels {
  const r = t.auth.reset;
  return {
    formName: r.title,
    username: r.fields.username,
    code: r.fields.code,
    codeHint: r.fields.codeHint,
    password: r.fields.password,
    passwordHint: r.fields.passwordHint,
    submit: r.submit,
    pending: r.pending,
    errorPrefix: r.errors.prefix,
    doneTitle: r.done.title,
    doneBody: r.done.body,
    doneLink: r.done.link,
    signInHref: AUTH_LINKS.signIn,
  };
}

/**
 * `/reset` (#789, bible 14.3 "Password reset screen"): the third screen of the form family of #36.
 * The red kicker, the Stardos H1, one sentence, then one paper docket (header `FORM 1-C` + ink tag;
 * the reset form; the switch row to `/sign-in`). No email field and no recovery-code text (R152).
 */
export async function ResetScreen() {
  const t = await getT();
  const r = t.auth.reset;
  return (
    <section className={styles.screen} aria-labelledby="reset-title">
      <div className={styles.column}>
        <div className={styles.kicker}>{r.kicker}</div>
        <h1 id="reset-title" className={`${styles.title} ink-misregister`}>
          {r.title}
        </h1>
        <p className={styles.lede}>{r.lede}</p>
        <div className={styles.docket}>
          <div className={styles.docketHeader}>
            <span className={styles.docketForm}>{r.form}</span>
            <span className={styles.tag}>{r.tag}</span>
          </div>
          <div className={styles.section}>
            <ResetForm labels={resetFormLabels(t)} action={redeemPasswordResetAction} />
          </div>
          <p className={styles.switch}>
            <span>{r.switchPrompt}</span>
            <a href={AUTH_LINKS.signIn} className={styles.link}>
              {r.switchLink}
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
