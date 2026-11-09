import { getT } from "@/i18n";
import { redeemRecoveryCodeAction } from "../actions/redeem-recovery-code";
import { AUTH_LINKS } from "./auth-screen";
import styles from "./auth.module.css";
import { RecoverForm, type RecoverFormLabels } from "./recover-form";
import type { RecoveryCardLabels } from "./recovery-card";

type Messages = Awaited<ReturnType<typeof getT>>;

/** The recovery card strings, all from `auth.recovery.reveal` (#46). */
export function recoveryCardLabels(t: Messages): RecoveryCardLabels {
  const r = t.auth.recovery.reveal;
  return {
    listName: r.listName,
    stamp: r.stamp,
    warningTitle: r.warning.title,
    warning: r.warning.primary,
    warningOther: r.warning.other,
    warningOtherLang: r.warning.otherLang,
    copy: r.copy,
    copied: r.copied,
    copiedStatus: r.copiedStatus,
    selectedStatus: r.selectedStatus,
    ack: r.ack,
    continue: r.continue,
  };
}

/** The `/recover` form labels, all from `auth.recovery` (#46). */
export function recoverFormLabels(t: Messages): RecoverFormLabels {
  const r = t.auth.recovery;
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
    signInHref: AUTH_LINKS.signIn,
    card: recoveryCardLabels(t),
  };
}

/**
 * `/recover` (#46, bible 14.3 "Recovery code"): the form-screen family of #36 and #789. The red kicker,
 * the Stardos H1, one sentence, then one paper docket (header `FORM 1-E` + ink tag; the recover form;
 * the switch row to `/sign-in`). No email field (R152).
 */
export async function RecoverScreen() {
  const t = await getT();
  const r = t.auth.recovery;
  return (
    <section className={styles.screen} aria-labelledby="recover-title">
      <div className={styles.column}>
        <div className={styles.kicker}>{r.kicker}</div>
        <h1 id="recover-title" className={`${styles.title} ink-misregister`}>
          {r.title}
        </h1>
        <p className={styles.lede}>{r.lede}</p>
        <div className={styles.docket}>
          <div className={styles.docketHeader}>
            <span className={styles.docketForm}>{r.form}</span>
            <span className={styles.tag}>{r.tag}</span>
          </div>
          <div className={styles.section}>
            <RecoverForm labels={recoverFormLabels(t)} action={redeemRecoveryCodeAction} />
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
